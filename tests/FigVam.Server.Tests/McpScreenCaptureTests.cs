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

    [Theory]
    [InlineData("Light", 2, 1)]
    [InlineData("Dark", 3, 1)]
    [InlineData("Dark", 2, 2)]
    public async Task RejectsWrongThemeOrDimensions(string submittedTheme, int width, int height)
    {
        var registry = new McpAccessRegistry();
        var service = new ScreenCaptureService();
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var provider = service.Register(doc, "alice", null, default, () => true)!;
        var call = service.CaptureAsync(grant, screen, 4, default, "Dark", width, height);
        var request = (await provider.Reader.ReadAsync()).Request;
        Assert.Equal("Dark", request.Theme);
        Assert.True(service.Complete(provider, request.RequestId, screen, 4,
            ScreenCaptureResult.FromPng(DocumentAssetTests.Png()) with { Theme = submittedTheme }));
        Assert.Equal("CAPTURE_FAILED", (await call).Code);
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

        // The 100 ms deadline belongs only to the timeout case. Cancellation
        // and disconnect must not race that deadline on a busy CI runner.
        service.Disconnect(provider);
        service = new ScreenCaptureService();
        provider = service.Register(doc, "alice", null, default, () => true)!;
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
    public async Task ConcurrentGrantsQueueIndependentThemesOnOneProvider()
    {
        var registry = new McpAccessRegistry();
        var service = new ScreenCaptureService();
        var doc = Guid.NewGuid();
        var screen = Guid.NewGuid();
        var direct = registry.Grant(doc, "alice");
        var tunnel = registry.GrantTunnel(doc, "alice")!;
        var provider = service.Register(doc, "alice", null, default, () => true)!;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var image = ScreenCaptureResult.FromPng(DocumentAssetTests.Png());
        var light = service.CaptureAsync(direct, screen, 4, deadline.Token, "Light", image.Width, image.Height);
        var first = (await provider.Reader.ReadAsync(deadline.Token)).Request;
        var dark = service.CaptureAsync(tunnel, screen, 4, deadline.Token, "Dark", image.Width, image.Height);
        Assert.False(dark.IsCompleted);
        Assert.Equal("Light", first.Theme);
        Assert.True(service.Complete(provider, first.RequestId, screen, 4, image with { Theme = "Light" }));
        Assert.Equal("Light", (await light).Theme);
        var second = (await provider.Reader.ReadAsync(deadline.Token)).Request;
        Assert.NotEqual(first.RequestId, second.RequestId);
        Assert.Equal("Dark", second.Theme);
        Assert.False(service.Complete(provider, first.RequestId, screen, 4, image with { Theme = "Light" }));
        Assert.True(service.Complete(provider, second.RequestId, screen, 4, image with { Theme = "Dark" }));
        Assert.Equal("Dark", (await dark).Theme);
        service.Disconnect(provider);
    }

    [Fact]
    public async Task SharedProviderReconnectsDuringAnAutonomousCapture()
    {
        var registry = new McpAccessRegistry();
        var service = new ScreenCaptureService();
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var old = service.Register(doc, "alice", null, default, () => true, reconnectable: true)!;
        service.Disconnect(old);
        var call = service.CaptureAsync(grant, screen, 4, default, "Dark");
        Assert.False(call.IsCompleted);
        var next = service.Register(doc, "alice", null, default, () => true, reconnectable: true)!;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var request = (await next.Reader.ReadAsync(deadline.Token)).Request;
        service.Disconnect(next);
        var replacement = service.Register(doc, "alice", null, default, () => true, reconnectable: true)!;
        var retried = (await replacement.Reader.ReadAsync(deadline.Token)).Request;
        Assert.NotEqual(request.RequestId, retried.RequestId);
        Assert.Equal(request.ScreenId, retried.ScreenId);
        Assert.Equal(request.Revision, retried.Revision);
        Assert.Equal(request.Theme, retried.Theme);
        var image = ScreenCaptureResult.FromPng(DocumentAssetTests.Png());
        Assert.False(service.Complete(next, request.RequestId, screen, 4, image));
        Assert.True(service.Complete(replacement, retried.RequestId, screen, 4, image));
        Assert.Equal("OK", (await call).Code);
        service.Disconnect(replacement);
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
