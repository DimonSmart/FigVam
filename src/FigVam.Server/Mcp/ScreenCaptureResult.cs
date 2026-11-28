using FigVam.Domain.Documents;

namespace FigVam.Server.Mcp;

public sealed record ScreenCaptureResult(string Code, byte[]? Png = null, int Width = 0, int Height = 0, string? Theme = null)
{
    public const int MaxPngBytes = DocumentAssetValidator.MaxAssetBytes;

    public static ScreenCaptureResult FromPng(byte[] bytes)
    {
        if (bytes.Length > MaxPngBytes) return new("IMAGE_TOO_LARGE");
        var image = SafeRasterImage.InspectCapture(bytes);
        return image is null ? new("CAPTURE_FAILED") : new("OK", bytes, image.Width, image.Height);
    }
}

public interface IScreenCaptureService
{
    Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, Guid screenId, long revision, CancellationToken ct, string? theme = null, int width = 0, int height = 0);
}

