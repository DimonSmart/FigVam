namespace FigVam.Domain.Documents;

// Dimensions are logical uiUnits, with the same finite, non-negative bounds as reference layout.
public sealed record ScreenDimensions(
    [property: System.Text.Json.Serialization.JsonRequired] double Width,
    [property: System.Text.Json.Serialization.JsonRequired] double Height)
{
    public static bool IsValid(ScreenDimensions? value) => value is not null &&
        double.IsFinite(value.Width) && value.Width >= 0 && double.IsFinite(value.Height) && value.Height >= 0;
}
