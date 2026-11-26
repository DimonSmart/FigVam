using FigVam.Server.Mcp;

namespace FigVam.Server.Tests;

public sealed class McpScreenCaptureTests
{
    [Fact]
    public async Task RoutesAnyScreenOnlyToTheMatchingDocumentAndUser()
    {
        var registry = new McpAccessRegistry();
        var service = new ScreenCaptureService();
        var doc = Guid.NewGuid();
        var screen = Guid.NewGuid();
        var alice = registry.Grant(doc, "alice");
        var bob = registry.Grant(doc, "bob");
        Assert.Equal("RENDERER_UNAVAILABLE", (await service.CaptureAsync(alice, screen, 4, default)).Code);
        var provider = service.Register(doc, "alice", "session-a", default, () => true)!;
        Assert.Null(service.Find(provider.Id, doc, "bob", "session-a"));
        Assert.Null(service.Find(provider.Id, doc, "alice", "session-b"));
        Assert.Null(service.Find(provider.Id, Guid.NewGuid(), "alice", "session-a"));
        Assert.Equal("RENDERER_UNAVAILABLE", (await service.CaptureAsync(bob, screen, 4, default)).Code);
        Assert.Equal("RENDERER_UNAVAILABLE", (await service.CaptureAsync(registry.Grant(Guid.NewGuid(), "alice"), screen, 4, default)).Code);
        var call = service.CaptureAsync(alice, screen, 4, default);
        var request = (await provider.Reader.ReadAsync()).Request;
        Assert.Equal(doc, request.DocumentId);
        Assert.Equal(screen, request.ScreenId);
        Assert.Equal(4, request.Revision);
        var image = ScreenCaptureResult.FromPng(DocumentAssetTests.Png());
        Assert.Equal("OK", image.Code);
        Assert.False(service.Complete(provider, Guid.NewGuid(), screen, 4, image));
        Assert.True(service.Complete(provider, request.RequestId, screen, 4, image));
        var result = await call;
        Assert.Equal("OK", result.Code);
        Assert.Equal(2, result.Width);
        Assert.Equal(1, result.Height);
        Assert.Equal(DocumentAssetTests.Png(), result.Png);
        Assert.False(service.Complete(provider, request.RequestId, screen, 4, image));
        service.Disconnect(provider);
    }

    [Theory]
    [InlineData(false, 3, "RENDER_REVISION_MISMATCH")]
    [InlineData(true, 4, "CAPTURE_FAILED")]
    public async Task RejectsMismatchedImageMetadata(bool wrongScreen, long revision, string code)
    {
        var registry = new McpAccessRegistry();
        var service = new ScreenCaptureService();
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var provider = service.Register(doc, "alice", null, default, () => true)!;
        var call = service.CaptureAsync(grant, screen, 4, default);
        var request = (await provider.Reader.ReadAsync()).Request;
        Assert.True(service.Complete(provider, request.RequestId, wrongScreen ? Guid.NewGuid() : screen, revision,
            ScreenCaptureResult.FromPng(DocumentAssetTests.Png())));
        var result = await call;
        Assert.Equal(code, result.Code);
        Assert.Null(result.Png);
        service.Disconnect(provider);
    }

    [Fact]
    public async Task TimeoutCancellationDisconnectAndRevocationNeverReturnLateImages()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var service = new ScreenCaptureService(TimeSpan.FromMilliseconds(100));
        var provider = service.Register(doc, "alice", null, default, () => true)!;
        var image = ScreenCaptureResult.FromPng(DocumentAssetTests.Png());
        var call = service.CaptureAsync(grant, screen, 4, default);
        var request = (await provider.Reader.ReadAsync()).Request;
        Assert.Equal("CAPTURE_TIMEOUT", (await call).Code);
        Assert.Equal("CANCEL", (await provider.Reader.ReadAsync()).Code);
        Assert.False(service.Complete(provider, request.RequestId, screen, 4, image));

        using var ct = new CancellationTokenSource();
        call = service.CaptureAsync(grant, screen, 4, ct.Token);
        await provider.Reader.ReadAsync();
        ct.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        Assert.Equal("CANCEL", (await provider.Reader.ReadAsync()).Code);
        call = service.CaptureAsync(grant, screen, 4, default);
        request = (await provider.Reader.ReadAsync()).Request;
        service.Disconnect(provider);
        Assert.Equal("CAPTURE_CANCELLED", (await call).Code);
        Assert.False(service.Complete(provider, request.RequestId, screen, 4, image));

        service = new ScreenCaptureService();
        provider = service.Register(doc, "alice", null, default, () => true)!;
        using var lease = await registry.EnterAsync(grant, default);
        call = service.CaptureAsync(grant, screen, 4, default);
        request = (await provider.Reader.ReadAsync()).Request;
        var revoke = registry.RevokeAsync(grant, default);
        Assert.Equal("CAPTURE_CANCELLED", (await call).Code);
        Assert.False(service.Complete(provider, request.RequestId, screen, 4, image));
        lease!.Dispose();
        await revoke;
        Assert.Null(registry.Resolve(grant.Token));
        Assert.Equal("CAPTURE_CANCELLED", (await service.CaptureAsync(grant, screen, 4, default)).Code);
        service.Disconnect(provider);
    }

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
    public async Task LossOfBrowserSessionDiscardsResult()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var service = new ScreenCaptureService();
        var active = true;
        var provider = service.Register(doc, "alice", "session", default, () => active)!;
        var call = service.CaptureAsync(grant, screen, 4, default);
        var request = (await provider.Reader.ReadAsync()).Request;
        active = false;
        Assert.False(service.Complete(provider, request.RequestId, screen, 4, ScreenCaptureResult.FromPng(DocumentAssetTests.Png())));
        service.Disconnect(provider);
        Assert.Equal("CAPTURE_CANCELLED", (await call).Code);
    }
}
