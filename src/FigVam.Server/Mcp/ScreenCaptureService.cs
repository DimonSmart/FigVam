using System.Threading.Channels;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;

namespace FigVam.Server.Mcp;

public sealed record ScreenCaptureRequest(Guid RequestId, Guid DocumentId, Guid ScreenId, long Revision, string? Theme = null, int Width = 0, int Height = 0);
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
public sealed record ScreenCaptureEvent(string Code, ScreenCaptureRequest Request);

public interface IScreenCaptureService
{
    Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, Guid screenId, long revision, CancellationToken ct, string? theme = null, int width = 0, int height = 0);
}

// One process, one outstanding request per browser connection. The channel carries
// only control messages, never pixels; image bytes live only in the pending call.
public sealed class ScreenCaptureService : IScreenCaptureService
{
    private readonly object sync = new();
    private readonly Dictionary<Guid, Provider> providers = new();
    private readonly TimeSpan timeout;

    public ScreenCaptureService() : this(TimeSpan.FromSeconds(10)) { }
    public ScreenCaptureService(TimeSpan timeout) => this.timeout = timeout;

    public sealed class Provider
    {
        internal Provider(Guid documentId, string userId, string? sessionId, CancellationToken lifetime, Func<bool> sessionActive)
        {
            DocumentId = documentId; UserId = userId; SessionId = sessionId;
            Lifetime = lifetime; SessionActive = sessionActive;
        }
        public Guid Id { get; } = Guid.NewGuid();
        public Guid DocumentId { get; }
        public string UserId { get; }
        public string? SessionId { get; }
        internal CancellationToken Lifetime { get; }
        internal Func<bool> SessionActive { get; }
        internal bool Closed { get; set; }
        internal Channel<ScreenCaptureEvent> Events { get; } = Channel.CreateUnbounded<ScreenCaptureEvent>();
        public ChannelReader<ScreenCaptureEvent> Reader => Events.Reader;
        internal Pending? Pending { get; set; }
        internal bool Available => !Closed && !Lifetime.IsCancellationRequested &&
            SessionActive();
    }

    internal sealed record Pending(ScreenCaptureRequest Request, McpDocumentGrant Grant)
    {
        public TaskCompletionSource<ScreenCaptureResult> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    public Provider? Register(Guid documentId, string userId, string? sessionId, CancellationToken lifetime, Func<bool> sessionActive)
    {
        lock (sync)
        {
            if (lifetime.IsCancellationRequested ||
                providers.Count >= 128 || providers.Values.Count(p => p.UserId == userId) >= 5)
                return null;
            var provider = new Provider(documentId, userId, sessionId, lifetime, sessionActive);
            if (!provider.Available) return null;
            providers.Add(provider.Id, provider);
            return provider;
        }
    }

    public void Disconnect(Provider provider)
    {
        lock (sync)
        {
            provider.Closed = true;
            providers.Remove(provider.Id);
            provider.Pending?.Completion.TrySetResult(new("CAPTURE_CANCELLED"));
            provider.Events.Writer.TryComplete();
        }
    }

    public Provider? Find(Guid id, Guid documentId, string userId, string? sessionId)
    {
        lock (sync)
            return providers.TryGetValue(id, out var p) && p.Available && p.DocumentId == documentId &&
                p.UserId == userId && p.SessionId == sessionId ? p : null;
    }

    public bool IsPending(Provider provider, Guid requestId)
    {
        lock (sync) return provider.Available && provider.Pending is { } pending &&
            pending.Request.RequestId == requestId && !pending.Grant.CaptureRevoked.IsCancellationRequested;
    }

    public bool Complete(Provider provider, Guid requestId, Guid screenId, long revision, ScreenCaptureResult result)
    {
        lock (sync)
        {
            if (!provider.Available || provider.Pending is not { } pending || pending.Request.RequestId != requestId || pending.Grant.CaptureRevoked.IsCancellationRequested)
                return false;
            if (result.Code == "OK")
            {
                if (screenId != pending.Request.ScreenId) result = new("CAPTURE_FAILED");
                else if (revision != pending.Request.Revision) result = new("RENDER_REVISION_MISMATCH");
                else if (pending.Request.Width > 0 && (result.Width != pending.Request.Width || result.Height != pending.Request.Height ||
                    result.Theme is not ("Light" or "Dark") || (pending.Request.Theme is not null && pending.Request.Theme != result.Theme)))
                    result = new("CAPTURE_FAILED");
            }
            return pending.Completion.TrySetResult(result);
        }
    }

    public async Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, Guid screenId, long revision, CancellationToken ct, string? theme = null, int width = 0, int height = 0)
    {
        Provider provider;
        Pending pending;
        lock (sync)
        {
            if (grant.CaptureRevoked.IsCancellationRequested) return new("CAPTURE_CANCELLED");
            var candidates = providers.Values.Where(p => p.Available && p.DocumentId == grant.DocumentId &&
                p.UserId == grant.UserId).ToArray();
            if (candidates.Length == 0) return new("RENDERER_UNAVAILABLE");
            var idle = candidates.FirstOrDefault(p => p.Pending is null);
            if (idle is null) return new("CAPTURE_FAILED");
            provider = idle;
            pending = new(new(Guid.NewGuid(), grant.DocumentId, screenId, revision, theme, width, height), grant);
            provider.Pending = pending;
            provider.Events.Writer.TryWrite(new("CAPTURE", pending.Request));
        }
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked, provider.Lifetime);
        try
        {
            var result = await pending.Completion.Task.WaitAsync(timeout, linked.Token);
            lock (sync) return provider.Available && !grant.CaptureRevoked.IsCancellationRequested
                ? result : new("CAPTURE_CANCELLED");
        }
        catch (TimeoutException) { return new("CAPTURE_TIMEOUT"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new("CAPTURE_CANCELLED"); }
        finally
        {
            lock (sync)
            {
                if (ReferenceEquals(provider.Pending, pending)) provider.Pending = null;
                if (!pending.Completion.Task.IsCompleted)
                    provider.Events.Writer.TryWrite(new("CANCEL", pending.Request));
            }
        }
    }
}
