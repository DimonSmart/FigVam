using FigVam.Server.Mcp;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;
using System.Threading.Channels;
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
        var disconnected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        first.Disconnected += (_, _) => disconnected.TrySetResult();
        var cdp = await first.NewBrowserCDPSessionAsync();
        try { await cdp.SendAsync("Browser.crash").WaitAsync(cancellation.Token); }
        catch (PlaywrightException) { } // The browser may close before replying.
        await disconnected.Task.WaitAsync(cancellation.Token);
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

    [Fact]
    public async Task ActiveCapturesRespectConcurrencyAndRevocationAndReleaseSlots()
    {
        await using var browser = new PlaywrightPreviewBrowser(NullLogger<PlaywrightPreviewBrowser>.Instance);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Mcp:RenderConcurrency"] = "2"
        }).Build();
        var assets = new BlockingAssets();
        var service = new HeadlessPreviewCapture(configuration, new TestQueries(), null!, assets, null!, browser);
        var doc = Guid.NewGuid();
        var screen = Guid.NewGuid();
        var registry = new McpAccessRegistry();
        var firstGrant = registry.Grant(doc, "one");
        var secondGrant = registry.Grant(doc, "two");
        var thirdGrant = registry.Grant(doc, "three");
        var session = PreviewSession.Start(new([new(screen, [])], [], [], [],
            new(screen, null, null, TokenTheme.Light, new(100, 100))));
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var secondCancellation = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
        using var thirdCancellation = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
        Task<ScreenCaptureResult> Capture(McpDocumentGrant grant, CancellationToken ct) =>
            service.CaptureAsync(grant, 1, session, session.Values, ct);

        var first = Capture(firstGrant, deadline.Token);
        Assert.Equal("one", await assets.Entered.Reader.ReadAsync(deadline.Token));
        var second = Capture(secondGrant, secondCancellation.Token);
        Assert.Equal("two", await assets.Entered.Reader.ReadAsync(deadline.Token));
        var third = Capture(thirdGrant, thirdCancellation.Token);
        Assert.False(assets.Entered.Reader.TryRead(out _));
        Assert.False(third.IsCompleted);

        await registry.RevokeAsync(firstGrant, deadline.Token);
        Assert.Equal("ACCESS_DENIED", (await first.WaitAsync(deadline.Token)).Code);
        Assert.Equal("three", await assets.Entered.Reader.ReadAsync(deadline.Token));
        secondCancellation.Cancel();
        thirdCancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await second);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await third);
    }

    private sealed class BlockingAssets : IDocumentAssets
    {
        public Channel<string> Entered { get; } = Channel.CreateUnbounded<string>();

        public async Task<DocumentAssetsResult> ListAsync(Guid documentId, DocumentActor actor, long? revision = null,
            Guid? versionId = null, CancellationToken cancellationToken = default)
        {
            await Entered.Writer.WriteAsync(actor.Id, cancellationToken);
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("The capture should have been cancelled.");
        }

        public Task<DocumentAssetReadResult> ReadAsync(Guid documentId, Guid assetId, DocumentActor actor,
            long? revision = null, Guid? versionId = null, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }

    private sealed class TestQueries : IDocumentStructureQueries
    {
        public Task<StructureQueryResult> QueryAsync(Guid documentId, StructureQuery query, DocumentActor actor,
            CancellationToken cancellationToken = default) => Task.FromResult(new StructureQueryResult("OK",
                new(documentId, 1, [new(query.ObjectId!.Value, "screen", Dimensions: new(100, 100))], 0, 1, 1)));

        public Task<DocumentProfileQueryResult> ReadProfileAsync(Guid documentId, long? revision, DocumentActor actor,
            CancellationToken cancellationToken = default) => Task.FromResult(new DocumentProfileQueryResult("OK",
                new(documentId, 1, PortableUiProfileReference.Current, [], [])));

        public Task<ScreenLayoutQueryResult> ReadScreenLayoutAsync(Guid documentId, ScreenLayoutQuery query,
            DocumentActor actor, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
