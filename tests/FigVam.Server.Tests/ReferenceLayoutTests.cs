using FigVam.Domain.Layout;

namespace FigVam.Server.Tests;

public class ReferenceLayoutTests
{
    private static LayoutNode Node(double width = 10, double height = 10, params Guid[] children) =>
        new(Guid.NewGuid(), LayoutDimension.Fixed(width), LayoutDimension.Fixed(height), children);
    private static LayoutResult Calculate(LayoutNode root, params LayoutNode[] descendants) =>
        ReferenceLayoutEngine.Calculate(new(root.Id, [root, .. descendants], new(300, 200)));
    private static LayoutRect Bounds(LayoutResult result, LayoutNode node)
    {
        Assert.Empty(result.Diagnostics);
        return Assert.Single(result.Boxes, b => b.ObjectId == node.Id).Bounds;
    }

    [Fact]
    public void NestedStacksMeasureContentBeforePositioningAndPreserveOrder()
    {
        var a = Node(20, 10); var b = Node(30, 15);
        var nested = Node(children: [b.Id, a.Id]) with
        {
            Width = LayoutDimension.Content(), Height = LayoutDimension.Content(), Flow = LayoutFlow.Vertical,
            Gap = 3, Padding = new(2, 4, 6, 8)
        };
        var root = Node(150, 100, nested.Id) with { Flow = LayoutFlow.Horizontal, Padding = new(10, 5, 0, 0) };
        var result = Calculate(root, a, b, nested);
        Assert.Equal(new(10, 5, 38, 40), Bounds(result, nested));
        Assert.Equal(new(12, 9, 30, 15), Bounds(result, b));
        Assert.Equal(new(12, 27, 20, 10), Bounds(result, a));
        Assert.Equal(new[] { root.Id, nested.Id, b.Id, a.Id }, result.Boxes.Select(box => box.ObjectId));
        Assert.Equal(result.Boxes, Calculate(root, a, b, nested).Boxes);
    }

    [Theory]
    [InlineData(LayoutFlow.Horizontal)]
    [InlineData(LayoutFlow.Vertical)]
    [InlineData(LayoutFlow.Free)]
    public void EmptyContentUsesPaddingWithoutPhantomGap(LayoutFlow flow)
    {
        var root = Node() with { Flow = flow, Width = LayoutDimension.Content(), Height = LayoutDimension.Content(), Padding = new(2, 3, 4, 5), Gap = 12 };
        Assert.Equal(new(0, 0, 6, 8), Bounds(Calculate(root), root));
    }

    [Fact]
    public void FreePlacementAndOutOfFlowChildrenRespectPaintOrderAndCoordinates()
    {
        var a = Node(20, 25) with { X = -5, Y = 7 };
        var b = Node(30, 15) with { X = 9, Y = 11 };
        var root = Node(100, 80, b.Id, a.Id) with { Padding = new(3, 4, 0, 0) };
        var result = Calculate(root, a, b);
        Assert.Equal(new(12, 15, 30, 15), Bounds(result, b));
        Assert.Equal(new(-2, 11, 20, 25), Bounds(result, a));
        Assert.Equal(new[] { root.Id, b.Id, a.Id }, result.Boxes.Select(box => box.ObjectId));
        root = root with { Flow = LayoutFlow.Horizontal };
        a = a with { OutOfFlow = true };
        result = Calculate(root, a, b);
        Assert.Equal(new(3, 4, 30, 15), Bounds(result, b));
        Assert.Equal(new(-2, 11, 20, 25), Bounds(result, a));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void WeightedFillDistributesSpaceAfterFixedSizesPaddingAndGap(bool horizontal)
    {
        var fixedNode = Node(20, 20);
        var a = Node() with { Width = horizontal ? LayoutDimension.Fill() : LayoutDimension.Fixed(10), Height = horizontal ? LayoutDimension.Fixed(10) : LayoutDimension.Fill() };
        var b = a with { Id = Guid.NewGuid(), Width = horizontal ? LayoutDimension.Fill(3) : a.Width, Height = horizontal ? a.Height : LayoutDimension.Fill(3) };
        var root = Node(140, 140, fixedNode.Id, a.Id, b.Id) with { Flow = horizontal ? LayoutFlow.Horizontal : LayoutFlow.Vertical, Padding = new(10, 10, 10, 10), Gap = 10 };
        var result = Calculate(root, a, b, fixedNode);
        Assert.Equal(20, horizontal ? Bounds(result, a).Width : Bounds(result, a).Height);
        Assert.Equal(60, horizontal ? Bounds(result, b).Width : Bounds(result, b).Height);
        Assert.Equal(70, horizontal ? Bounds(result, b).X : Bounds(result, b).Y);
    }

    [Theory]
    [InlineData(40, null, 50, 50)]
    [InlineData(0, 20d, 20, 80)]
    [InlineData(80, null, 80, 20)]
    public void FillRedistributesAtMinimumAndMaximum(double minimum, double? maximum, double expectedA, double expectedB)
    {
        var a = Node() with { Width = LayoutDimension.Fill(min: minimum, max: maximum) };
        var b = Node() with { Width = LayoutDimension.Fill() };
        var root = Node(100, 20, a.Id, b.Id) with { Flow = LayoutFlow.Horizontal };
        var result = Calculate(root, a, b);
        Assert.Equal(expectedA, Bounds(result, a).Width);
        Assert.Equal(expectedB, Bounds(result, b).Width);
    }

    [Fact]
    public void FillHandlesSimultaneousBoundsAndLargeWeights()
    {
        var a = Node() with { Width = LayoutDimension.Fill(double.MaxValue, min: 80) };
        var b = Node() with { Width = LayoutDimension.Fill(double.MaxValue, max: 10) };
        var root = Node(100, 20, a.Id, b.Id) with { Flow = LayoutFlow.Horizontal };
        var result = Calculate(root, a, b);
        Assert.Equal(90, Bounds(result, a).Width);
        Assert.Equal(10, Bounds(result, b).Width);
    }

    [Theory]
    [InlineData(LayoutAlignment.Start, 0)]
    [InlineData(LayoutAlignment.Center, 40)]
    [InlineData(LayoutAlignment.End, 80)]
    public void AlignmentUsesRemainingSpaceOnBothAxes(LayoutAlignment alignment, double offset)
    {
        var child = Node(20, 20);
        var root = Node(100, 100, child.Id) with { Flow = LayoutFlow.Horizontal, MainAlignment = alignment, CrossAlignment = alignment };
        Assert.Equal(new(offset, offset, 20, 20), Bounds(Calculate(root, child), child));
    }

    [Fact]
    public void CrossAxisFillAndRootFillRecalculateWithoutMutatingInput()
    {
        var child = Node() with { Width = LayoutDimension.Fill(), Height = LayoutDimension.Fill() };
        var root = Node(children: [child.Id]) with { Flow = LayoutFlow.Horizontal, Width = LayoutDimension.Fill(), Height = LayoutDimension.Fill(), Padding = new(3, 4, 5, 6) };
        var input = new LayoutInput(root.Id, [root, child], new(100, 80));
        Assert.Equal(new(3, 4, 92, 70), Bounds(ReferenceLayoutEngine.Calculate(input), child));
        Assert.Equal(new(3, 4, 192, 140), Bounds(ReferenceLayoutEngine.Calculate(input with { AvailableSize = new(200, 150) }), child));
        Assert.Equal(LayoutDimension.Fill(), child.Width);
    }

    [Fact]
    public void OverflowPreservesLogicalBoundsAndIntersectsAncestorClips()
    {
        var child = Node(100, 100) with { X = 30, Y = 40, Overflow = LayoutOverflow.Clip };
        var root = Node(50, 60, child.Id) with { Overflow = LayoutOverflow.Clip };
        var result = Calculate(root, child);
        Assert.Equal(new(30, 40, 100, 100), Bounds(result, child));
        Assert.Equal(new LayoutRect(30, 40, 20, 20), result.Boxes[1].Clip);
        result = Calculate(root with { Overflow = LayoutOverflow.Visible }, child with { Overflow = LayoutOverflow.Visible });
        Assert.All(result.Boxes, box => Assert.Null(box.Clip));
    }

    [Fact]
    public void MinimumsMayOverflowAndContentLimitsClamp()
    {
        var a = Node() with { Width = LayoutDimension.Fill(min: 80) };
        var b = a with { Id = Guid.NewGuid() };
        var root = Node(100, 20, a.Id, b.Id) with { Flow = LayoutFlow.Horizontal };
        var result = Calculate(root, a, b);
        Assert.Equal(80, Bounds(result, a).Width);
        Assert.Equal(160, Bounds(result, b).X + Bounds(result, b).Width);
        var empty = Node() with { Width = LayoutDimension.Content(12, 20), Height = LayoutDimension.Content(max: 5), Padding = new(0, 8, 0, 8) };
        Assert.Equal(new(0, 0, 12, 5), Bounds(Calculate(empty), empty));
    }

    [Fact]
    public void TextMeasurementReceivesActualWidthAndReflowsOnResize()
    {
        var text = Node() with { Text = "abcdefghij", Width = LayoutDimension.Fill(), Height = LayoutDimension.Content() };
        var root = Node(50, 200, text.Id) with { Flow = LayoutFlow.Vertical };
        var widths = new List<double?>();
        LayoutSize Measure(LayoutNode n, double? width)
        {
            widths.Add(width);
            return new(Math.Min(100, width ?? 100), Math.Ceiling(100 / Math.Max(1, width ?? 100)) * 10);
        }
        var result = ReferenceLayoutEngine.Calculate(new(root.Id, [root, text], new(300, 200)), Measure);
        Assert.Equal(new(0, 0, 50, 20), Bounds(result, text));
        Assert.Contains(50d, widths);
        result = ReferenceLayoutEngine.Calculate(new(root.Id, [root with { Width = LayoutDimension.Fixed(25) }, text], new(300, 200)), Measure);
        Assert.Equal(new(0, 0, 25, 40), Bounds(result, text));
    }

    [Fact]
    public void ContentTextUsesIntrinsicWidthInContentParent()
    {
        var text = Node() with { Text = "text", Width = LayoutDimension.Content(), Height = LayoutDimension.Content() };
        var root = Node(children: [text.Id]) with { Width = LayoutDimension.Content(), Height = LayoutDimension.Content(), Flow = LayoutFlow.Vertical };
        var widths = new List<double?>();
        var result = ReferenceLayoutEngine.Calculate(new(root.Id, [root, text], new(300, 200)), (_, width) => { widths.Add(width); return new(40, 12); });
        Assert.Equal(new(0, 0, 40, 12), Bounds(result, root));
        Assert.Equal(new double?[] { null, 40 }, widths);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    [InlineData(-1)]
    public void InvalidSizesHaveAddressedDiagnosticsAndNoPartialBounds(double value)
    {
        var root = Node(value);
        var result = Calculate(root);
        Assert.Empty(result.Boxes);
        Assert.Contains(result.Diagnostics, e => e.ObjectId == root.Id && e.Property == "Width.Value" && e.Code == "invalid-number");
    }

    [Fact]
    public void InvalidConstraintsAndMeasurementAreDiagnosed()
    {
        foreach (var dimension in new[] { LayoutDimension.Fill(0), LayoutDimension.Content(20, 10), new(LayoutSizeMode.Fixed, 10, 20) })
            Assert.False(Calculate(Node() with { Width = dimension }).IsSuccess);
        var text = Node() with { Text = "x", Width = LayoutDimension.Content() };
        Assert.False(Calculate(text).IsSuccess);
        var result = ReferenceLayoutEngine.Calculate(new(text.Id, [text], new(100, 100)), (_, _) => new(double.NaN, 10));
        Assert.Contains(result.Diagnostics, d => d.Property == "Text.Width");
        result = ReferenceLayoutEngine.Calculate(new(text.Id, [text], new(100, 100)), (_, _) => throw new InvalidOperationException("font unavailable"));
        Assert.Contains(result.Diagnostics, d => d.Code == "text-measurement" && d.ObjectId == text.Id);
    }

    [Fact]
    public void StructuralAndSizeDependencyCyclesAreDiagnosed()
    {
        var a = Node(); var b = Node(children: [a.Id]); a = a with { ChildIds = [b.Id] };
        Assert.Contains(Calculate(a, b).Diagnostics, d => d.Code == "cycle");
        var child = Node() with { Width = LayoutDimension.Fill() };
        var root = Node(children: [child.Id]) with { Width = LayoutDimension.Content(), Flow = LayoutFlow.Horizontal };
        var result = Calculate(root, child);
        Assert.Empty(result.Boxes);
        Assert.Contains(result.Diagnostics, d => d.Code == "cyclic-constraint" && d.Property == "Width");
        child = child with { Width = LayoutDimension.Fixed(10), Height = LayoutDimension.Fill() };
        root = root with { Width = LayoutDimension.Fixed(50), Height = LayoutDimension.Content(), Flow = LayoutFlow.Vertical };
        Assert.Contains(Calculate(root, child).Diagnostics, d => d.Code == "cyclic-constraint" && d.Property == "Height");
    }

    [Fact]
    public void BrokenTreesAndArithmeticOverflowAreDiagnosed()
    {
        var child = Node(); var root = Node(children: [child.Id]);
        Assert.Contains(Calculate(root).Diagnostics, d => d.Code == "missing-child" && d.ObjectId == root.Id);
        Assert.Contains(Calculate(root with { ChildIds = [child.Id, child.Id] }, child).Diagnostics, d => d.Code == "multiple-parents");
        Assert.Contains(Calculate(root with { ChildIds = [] }, child).Diagnostics, d => d.Code == "disconnected-node");
        var huge = Node(double.MaxValue) with { X = double.MaxValue };
        root = Node(children: [huge.Id]) with { Width = LayoutDimension.Content() };
        Assert.Contains(Calculate(root, huge).Diagnostics, d => d.Code == "invalid-number");
    }
}
