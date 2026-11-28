using FigVam.Server.Mcp;
using Microsoft.Extensions.Logging.Abstractions;

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

    [Fact]
    public async Task BrowserIsReusedAndRecreatedAfterDisconnect()
    {
        await using var renderer = new PlaywrightPreviewBrowser(NullLogger<PlaywrightPreviewBrowser>.Instance);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var first = await renderer.GetBrowserAsync(cancellation.Token);
        var second = await renderer.GetBrowserAsync(cancellation.Token);
        Assert.Same(first, second);
        await first.CloseAsync();
        Assert.False(first.IsConnected);
        var recovered = await renderer.GetBrowserAsync(cancellation.Token);
        Assert.NotSame(first, recovered);
        Assert.True(recovered.IsConnected);
    }

    [Fact]
    public async Task CancelledRequestDoesNotLaunchBrowser()
    {
        await using var renderer = new PlaywrightPreviewBrowser(NullLogger<PlaywrightPreviewBrowser>.Instance);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => renderer.GetBrowserAsync(new CancellationToken(true)));
    }
}
