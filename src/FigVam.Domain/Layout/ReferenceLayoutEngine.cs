namespace FigVam.Domain.Layout;

public static class ReferenceLayoutEngine
{
    public static LayoutResult Calculate(LayoutInput input, MeasureLayoutText? measureText = null)
    {
        ArgumentNullException.ThrowIfNull(input);
        return new Calculation(input, measureText).Run();
    }

    private sealed class Calculation(LayoutInput input, MeasureLayoutText? measureText)
    {
        private readonly Dictionary<Guid, LayoutNode> nodes = [];
        private readonly Dictionary<Guid, Guid> parents = [];
        private readonly Dictionary<(Guid, bool), double> sizes = [];
        private readonly HashSet<(Guid, bool)> active = [];
        private readonly List<LayoutDiagnostic> errors = [];
        private readonly List<LayoutBox> boxes = [];
        private sealed class InvalidLayout : Exception;

        private void Fail(string code, Guid id, string property, string message)
        {
            errors.Add(new(code, id, property, message));
            throw new InvalidLayout();
        }

        public LayoutResult Run()
        {
            try
            {
                Validate();
                foreach (var node in input.Nodes) { Size(node.Id, true); Size(node.Id, false); }
                Place(input.RootId, 0, 0, null);
            }
            catch (InvalidLayout) { boxes.Clear(); }
            return new(boxes.ToArray(), errors.ToArray());
        }

        private void Number(double value, Guid id, string property, bool nonnegative = true)
        {
            if (!double.IsFinite(value) || (nonnegative && value < 0))
                Fail("invalid-number", id, property, "Expected a finite" + (nonnegative ? " nonnegative" : "") + " number.");
        }

        private void Validate()
        {
            Number(input.AvailableSize.Width, input.RootId, "AvailableSize.Width");
            Number(input.AvailableSize.Height, input.RootId, "AvailableSize.Height");
            foreach (var node in input.Nodes)
            {
                if (node.Id == Guid.Empty || !nodes.TryAdd(node.Id, node))
                    Fail("invalid-id", node.Id, "Id", "Node IDs must be nonempty and unique.");
                foreach (var horizontal in new[] { true, false })
                {
                    var d = Dimension(node, horizontal); var property = Axis(horizontal);
                    if (!Enum.IsDefined(d.Mode)) Fail("invalid-mode", node.Id, property, "Unknown size mode.");
                    Number(d.Value, node.Id, property + ".Value"); Number(d.Min, node.Id, property + ".Min");
                    if (d.Max is double max)
                    {
                        Number(max, node.Id, property + ".Max");
                        if (max < d.Min) Fail("impossible-constraint", node.Id, property, "Maximum is less than minimum.");
                    }
                    if (d.Mode == LayoutSizeMode.Fill && d.Value <= 0)
                        Fail("invalid-weight", node.Id, property + ".Value", "Fill weight must be positive.");
                    if (d.Mode == LayoutSizeMode.Fixed && (d.Value < d.Min || d.Value > (d.Max ?? double.MaxValue)))
                        Fail("impossible-constraint", node.Id, property, "Fixed size violates its limits.");
                }
                Number(node.X, node.Id, "X", false); Number(node.Y, node.Id, "Y", false);
                Number(node.Gap, node.Id, "Gap");
                Number(node.Padding.Left, node.Id, "Padding.Left"); Number(node.Padding.Top, node.Id, "Padding.Top");
                Number(node.Padding.Right, node.Id, "Padding.Right"); Number(node.Padding.Bottom, node.Id, "Padding.Bottom");
                if (!Enum.IsDefined(node.Flow) || !Enum.IsDefined(node.MainAlignment) || !Enum.IsDefined(node.CrossAlignment) || !Enum.IsDefined(node.Overflow))
                    Fail("invalid-enum", node.Id, "Layout", "Unknown layout option.");
                if (node.Text is not null && (node.ChildIds.Count != 0 || measureText is null))
                    Fail("invalid-text", node.Id, "Text", "Text requires a measurer and cannot contain children.");
            }
            if (!nodes.ContainsKey(input.RootId)) Fail("missing-root", input.RootId, "RootId", "Root node does not exist.");
            foreach (var node in input.Nodes)
                foreach (var child in node.ChildIds)
                {
                    if (!nodes.ContainsKey(child)) Fail("missing-child", node.Id, "ChildIds", $"Child {child} does not exist.");
                    if (!parents.TryAdd(child, node.Id)) Fail("multiple-parents", child, "ChildIds", "Each child must occur exactly once.");
                }
            var visited = new HashSet<Guid>(); var visiting = new HashSet<Guid>();
            void Visit(Guid id)
            {
                if (!visiting.Add(id)) Fail("cycle", id, "ChildIds", "Tree contains a cycle.");
                if (visited.Add(id)) foreach (var child in nodes[id].ChildIds) Visit(child);
                visiting.Remove(id);
            }
            foreach (var node in input.Nodes) Visit(node.Id);
            if (parents.ContainsKey(input.RootId)) Fail("invalid-root", input.RootId, "RootId", "Root cannot have a parent.");
            foreach (var node in input.Nodes)
                if (node.Id != input.RootId && !parents.ContainsKey(node.Id)) Fail("disconnected-node", node.Id, "ChildIds", "Node is outside the root tree.");
        }

        private static string Axis(bool horizontal) => horizontal ? "Width" : "Height";
        private static LayoutDimension Dimension(LayoutNode n, bool horizontal) => horizontal ? n.Width : n.Height;
        private static double Padding(LayoutNode n, bool horizontal) => horizontal ? n.Padding.Left + n.Padding.Right : n.Padding.Top + n.Padding.Bottom;
        private static bool Main(LayoutNode n, bool horizontal) => horizontal ? n.Flow == LayoutFlow.Horizontal : n.Flow == LayoutFlow.Vertical;
        private static double Clamp(double value, LayoutDimension d) => Math.Clamp(value, d.Min, d.Max ?? double.MaxValue);
        private double Inner(Guid id, bool horizontal) => Math.Max(0, Size(id, horizontal) - Padding(nodes[id], horizontal));
        private double Available(Guid id, bool horizontal) => parents.TryGetValue(id, out var parent)
            ? Inner(parent, horizontal) : horizontal ? input.AvailableSize.Width : input.AvailableSize.Height;

        private LayoutSize Measure(LayoutNode node, double? width)
        {
            LayoutSize result;
            try { result = measureText!(node, width); }
            catch (Exception exception) { Fail("text-measurement", node.Id, "Text", exception.Message); throw; }
            Number(result.Width, node.Id, "Text.Width"); Number(result.Height, node.Id, "Text.Height");
            return result;
        }

        private double Size(Guid id, bool horizontal)
        {
            var key = (id, horizontal);
            if (sizes.TryGetValue(key, out var cached)) return cached;
            if (!active.Add(key)) Fail("cyclic-constraint", id, Axis(horizontal), "Size depends on itself through Content/Fill constraints.");
            var node = nodes[id]; var d = Dimension(node, horizontal); double value;
            if (d.Mode == LayoutSizeMode.Fixed) value = d.Value;
            else if (d.Mode == LayoutSizeMode.Fill)
            {
                if (parents.TryGetValue(id, out var parent) && Main(nodes[parent], horizontal) && !node.OutOfFlow)
                    value = AllocateFill(nodes[parent], horizontal)[id];
                else value = Clamp(Available(id, horizontal), d);
            }
            else
            {
                if (node.Text is not null)
                {
                    double? width = horizontal
                        ? parents.TryGetValue(id, out var parent) && nodes[parent].Width.Mode == LayoutSizeMode.Content ? null : Math.Max(0, Available(id, true) - Padding(node, true))
                        : Math.Max(0, Size(id, true) - Padding(node, true));
                    var measured = Measure(node, width);
                    value = (horizontal ? measured.Width : measured.Height) + Padding(node, horizontal);
                }
                else
                {
                    var children = node.ChildIds.Select(child => nodes[child]).ToArray();
                    var flow = children.Where(child => !child.OutOfFlow).ToArray();
                    value = Main(node, horizontal)
                        ? flow.Sum(child => Size(child.Id, horizontal)) + Math.Max(0, flow.Length - 1) * node.Gap
                        : flow.Select(child => Size(child.Id, horizontal) + (node.Flow == LayoutFlow.Free ? horizontal ? child.X : child.Y : 0)).DefaultIfEmpty(0).Max();
                    foreach (var child in children.Where(child => child.OutOfFlow))
                        value = Math.Max(value, Size(child.Id, horizontal) + (horizontal ? child.X : child.Y));
                    value = Math.Max(0, value) + Padding(node, horizontal);
                }
                value = Clamp(value, d);
            }
            Number(value, id, Axis(horizontal));
            active.Remove(key); sizes[key] = value; return value;
        }

        private Dictionary<Guid, double> AllocateFill(LayoutNode parent, bool horizontal)
        {
            var children = parent.ChildIds.Select(id => nodes[id]).Where(n => !n.OutOfFlow).ToArray();
            var fill = children.Where(n => Dimension(n, horizontal).Mode == LayoutSizeMode.Fill).ToList();
            var budget = Math.Max(0, Inner(parent.Id, horizontal) - Math.Max(0, children.Length - 1) * parent.Gap
                - children.Where(n => Dimension(n, horizontal).Mode != LayoutSizeMode.Fill).Sum(n => Size(n.Id, horizontal)));
            var result = new Dictionary<Guid, double>();
            if (fill.Sum(n => Dimension(n, horizontal).Min) >= budget)
                return fill.ToDictionary(n => n.Id, n => Dimension(n, horizontal).Min);
            while (fill.Count > 0)
            {
                // Scale weights first to avoid overflow when several finite weights are very large.
                var scale = fill.Max(n => Dimension(n, horizontal).Value);
                var weight = fill.Sum(n => Dimension(n, horizontal).Value / scale);
                var shares = fill.ToDictionary(n => n.Id, n => budget * (Dimension(n, horizontal).Value / scale) / weight);
                var below = fill.Where(n => shares[n.Id] < Dimension(n, horizontal).Min).ToArray();
                var above = fill.Where(n => shares[n.Id] > (Dimension(n, horizontal).Max ?? double.MaxValue)).ToArray();
                if (below.Length == 0 && above.Length == 0)
                {
                    foreach (var n in fill) result[n.Id] = shares[n.Id];
                    break;
                }
                var clampMinimum = fill.Sum(n => Clamp(shares[n.Id], Dimension(n, horizontal))) > budget;
                var capped = clampMinimum ? below : above;
                foreach (var n in capped)
                {
                    var d = Dimension(n, horizontal);
                    var value = clampMinimum ? d.Min : d.Max!.Value;
                    budget -= value; result[n.Id] = value; fill.Remove(n);
                }
            }
            return result;
        }

        private static double Offset(LayoutAlignment alignment, double remaining) => alignment switch
        {
            LayoutAlignment.Center => remaining / 2,
            LayoutAlignment.End => remaining,
            _ => 0
        };

        private static LayoutRect Intersect(LayoutRect a, LayoutRect b)
        {
            var x = Math.Max(a.X, b.X); var y = Math.Max(a.Y, b.Y);
            return new(x, y, Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - x), Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - y));
        }

        private void Place(Guid id, double x, double y, LayoutRect? inheritedClip)
        {
            var n = nodes[id]; var bounds = new LayoutRect(x, y, Size(id, true), Size(id, false));
            Number(x, id, "Bounds.X", false); Number(y, id, "Bounds.Y", false);
            Number(x + bounds.Width, id, "Bounds.Right", false); Number(y + bounds.Height, id, "Bounds.Bottom", false);
            var clip = n.Overflow == LayoutOverflow.Clip ? inheritedClip is { } ancestor ? Intersect(ancestor, bounds) : bounds : inheritedClip;
            boxes.Add(new(id, bounds, clip));
            var horizontal = n.Flow == LayoutFlow.Horizontal;
            var flow = n.ChildIds.Select(child => nodes[child]).Where(child => !child.OutOfFlow).ToArray();
            var used = flow.Sum(child => Size(child.Id, horizontal)) + Math.Max(0, flow.Length - 1) * n.Gap;
            var cursor = Offset(n.MainAlignment, Inner(id, horizontal) - used);
            foreach (var childId in n.ChildIds)
            {
                var child = nodes[childId]; double cx = child.X; double cy = child.Y;
                if (n.Flow != LayoutFlow.Free && !child.OutOfFlow)
                {
                    var cross = Offset(n.CrossAlignment, Inner(id, !horizontal) - Size(childId, !horizontal));
                    cx = horizontal ? cursor : cross; cy = horizontal ? cross : cursor;
                    cursor += Size(childId, horizontal) + n.Gap;
                }
                Place(childId, x + n.Padding.Left + cx, y + n.Padding.Top + cy, clip);
            }
        }
    }
}
