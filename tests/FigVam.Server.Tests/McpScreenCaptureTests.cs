using FigVam.Server.Mcp;

namespace FigVam.Server.Tests;

public sealed class McpScreenCaptureTests
{
    [Fact]
    public void PngValidationRejectsInvalidAndOversizedPayloads()
    {
        Assert.Equal("IMAGE_TOO_LARGE", ScreenCaptureResult.FromPng(new byte[ScreenCaptureResult.MaxPngBytes + 1]).Code);
        Assert.Equal("CAPTURE_FAILED", ScreenCaptureResult.FromPng([1, 2, 3]).Code);
        foreach (var bytes in DocumentAssetTests.InvalidPngs())
            Assert.Equal("CAPTURE_FAILED", ScreenCaptureResult.FromPng(bytes).Code);
        // Standard sRGB chunk written by browser encoders (rendering intent 0).
        var browserPng = DocumentAssetTests.Png(extra: Convert.FromHexString("000000017352474200AECE1CE9"));
        Assert.Equal("OK", ScreenCaptureResult.FromPng(browserPng).Code);
    }

}
