namespace FigVam.Domain.Layout;

public enum LayoutFlow { Free, Horizontal, Vertical }
public enum LayoutSizeMode { Fixed, Content, Fill }
public enum LayoutAlignment { Start, Center, End }
public enum LayoutOverflow { Visible, Clip }

public sealed record LayoutDimension(LayoutSizeMode Mode, double Value = 0, double Min = 0, double? Max = null)
{
    public static LayoutDimension Fixed(double size) => new(LayoutSizeMode.Fixed, size);
    public static LayoutDimension Content(double min = 0, double? max = null) => new(LayoutSizeMode.Content, 0, min, max);
    public static LayoutDimension Fill(double weight = 1, double min = 0, double? max = null) => new(LayoutSizeMode.Fill, weight, min, max);
}

public readonly record struct LayoutSize(double Width, double Height);
public readonly record struct LayoutRect(double X, double Y, double Width, double Height);
public readonly record struct LayoutPadding(double Left, double Top, double Right, double Bottom);

// ChildIds is both flow order and back-to-front paint order. Coordinates are parent-content-relative.
public sealed record LayoutNode(Guid Id, LayoutDimension Width, LayoutDimension Height, IReadOnlyList<Guid> ChildIds)
{
    public LayoutFlow Flow { get; init; } = LayoutFlow.Free;
    public LayoutPadding Padding { get; init; }
    public double Gap { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public bool OutOfFlow { get; init; }
    public LayoutAlignment MainAlignment { get; init; }
    public LayoutAlignment CrossAlignment { get; init; }
    public LayoutOverflow Overflow { get; init; }
    public string? Text { get; init; }
}

public sealed record LayoutInput(Guid RootId, IReadOnlyList<LayoutNode> Nodes, LayoutSize AvailableSize);
// A null available width requests intrinsic, unwrapped measurement in logical uiUnits.
public delegate LayoutSize MeasureLayoutText(LayoutNode node, double? availableWidth);
public sealed record LayoutDiagnostic(string Code, Guid ObjectId, string Property, string Message);
public sealed record LayoutBox(Guid ObjectId, LayoutRect Bounds, LayoutRect? Clip);
public sealed record LayoutResult(IReadOnlyList<LayoutBox> Boxes, IReadOnlyList<LayoutDiagnostic> Diagnostics)
{
    public bool IsSuccess => Diagnostics.Count == 0;
}
