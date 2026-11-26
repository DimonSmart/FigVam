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
    private static readonly TimeSpan ReconnectGrace = TimeSpan.FromSeconds(5);
    private readonly Dictionary<(Guid DocumentId, string UserId), long> reconnectable = new();
    private TaskCompletionSource<bool> providerChanged = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private void SignalProviderChanged()
    {
        var previous = providerChanged;
        providerChanged = new(TaskCreationOptions.RunContinuationsAsynchronously);
        previous.TrySetResult(true);
    }

    private void RememberReconnectable(Guid documentId, string userId)
    {
        var now = Environment.TickCount64;
        foreach (var key in reconnectable.Where(entry => entry.Value <= now).Select(entry => entry.Key).ToArray())
            reconnectable.Remove(key);
        reconnectable[(documentId, userId)] = now + (long)ReconnectGrace.TotalMilliseconds;
        if (reconnectable.Count > 256)
            reconnectable.Remove(reconnectable.MinBy(entry => entry.Value).Key);
    }

    public ScreenCaptureService() : this(TimeSpan.FromSeconds(10)) { }
    public ScreenCaptureService(TimeSpan timeout) => this.timeout = timeout;

    public sealed class Provider
    {
        internal Provider(Guid documentId, string userId, string? sessionId, CancellationToken lifetime, Func<bool> sessionActive, bool reconnectable)
        {
            DocumentId = documentId; UserId = userId; SessionId = sessionId;
            Lifetime = lifetime; SessionActive = sessionActive; Reconnectable = reconnectable;
        }
        public Guid Id { get; } = Guid.NewGuid();
        public Guid DocumentId { get; }
        public string UserId { get; }
        public string? SessionId { get; }
        internal CancellationToken Lifetime { get; }
        internal Func<bool> SessionActive { get; }
        internal bool Closed { get; set; }
        internal bool Reconnectable { get; }
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

    public Provider? Register(Guid documentId, string userId, string? sessionId, CancellationToken lifetime, Func<bool> sessionActive, bool reconnectable = false)
    {
        lock (sync)
        {
            // A cancelled stream may still be unwinding its controller.
            // Release its slot before admitting the replacement connection.
            foreach (var stale in providers.Values.Where(p => !p.Available).ToArray())
                Disconnect(stale);
            if (lifetime.IsCancellationRequested ||
                providers.Count >= 128 || providers.Values.Count(p => p.UserId == userId) >= 5)
                return null;
            var provider = new Provider(documentId, userId, sessionId, lifetime, sessionActive, reconnectable);
            if (!provider.Available) return null;
            providers.Add(provider.Id, provider);
            if (reconnectable) RememberReconnectable(documentId, userId);
            SignalProviderChanged();
            return provider;
        }
    }

    public void Disconnect(Provider provider)
    {
        lock (sync)
        {
            if (provider.Closed) return;
            provider.Closed = true;
            providers.Remove(provider.Id);
            if (provider.Reconnectable) RememberReconnectable(provider.DocumentId, provider.UserId);
            SignalProviderChanged();
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
        // The editor intentionally reconnects its document event stream during
        // local commands and selection changes. Only that opt-in transport gets
        // a short reconnect grace; the legacy dedicated provider keeps its contract.
        var started = Environment.TickCount64;
        using var grantLifetime = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked);
        while (true)
        {
            Provider? provider = null;
            Pending? pending = null;
            Task? changed = null;
            var waitForSlot = false;
            lock (sync)
            {
                if (grant.CaptureRevoked.IsCancellationRequested) return new("CAPTURE_CANCELLED");
                ct.ThrowIfCancellationRequested();
                var candidates = providers.Values.Where(p => p.Available && p.DocumentId == grant.DocumentId &&
                    p.UserId == grant.UserId).ToArray();
                if (candidates.Length > 0)
                {
                    provider = candidates.FirstOrDefault(p => p.Pending is null);
                    if (provider is null)
                    {
                        // Independent grants can target the same browser. Queue instead of
                        // rejecting a concurrent render, preserving its own theme and revision.
                        waitForSlot = true;
                        changed = providerChanged.Task;
                    }
                    else
                    {
                        pending = new(new(Guid.NewGuid(), grant.DocumentId, screenId, revision, theme, width, height), grant);
                        provider.Pending = pending;
                        provider.Events.Writer.TryWrite(new("CAPTURE", pending.Request));
                    }
                }
                else
                {
                    var now = Environment.TickCount64;
                    var key = (grant.DocumentId, grant.UserId);
                    var recent = reconnectable.TryGetValue(key, out var until) && until > now;
                    var disconnecting = providers.Values.Any(p => p.Reconnectable && p.DocumentId == grant.DocumentId && p.UserId == grant.UserId);
                    if (!recent && !disconnecting) return new("RENDERER_UNAVAILABLE");
                    changed = providerChanged.Task;
                }
            }
            var remaining = timeout - TimeSpan.FromMilliseconds(Environment.TickCount64 - started);
            if (changed is not null)
            {
                var grace = ReconnectGrace - TimeSpan.FromMilliseconds(Environment.TickCount64 - started);
                var wait = waitForSlot ? remaining : remaining < grace ? remaining : grace;
                var timeoutCode = waitForSlot ? "CAPTURE_TIMEOUT" : "RENDERER_UNAVAILABLE";
                if (wait <= TimeSpan.Zero) return new(timeoutCode);
                try { await changed.WaitAsync(wait, grantLifetime.Token); }
                catch (TimeoutException) { return new(timeoutCode); }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new("CAPTURE_CANCELLED"); }
                continue;
            }
            var result = await CaptureOnceAsync(provider!, pending!, grant, ct, remaining);
            if (result.Code != "CAPTURE_CANCELLED" || !provider!.Reconnectable ||
                grant.CaptureRevoked.IsCancellationRequested || provider.Available ||
                Environment.TickCount64 - started >= ReconnectGrace.TotalMilliseconds)
                return result;
            // A new request ID is allocated on the replacement provider; late
            // results from the disconnected browser cannot complete this call.
        }
    }

    private async Task<ScreenCaptureResult> CaptureOnceAsync(Provider provider, Pending pending,
        McpDocumentGrant grant, CancellationToken ct, TimeSpan remaining)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked, provider.Lifetime);
        try
        {
            if (remaining <= TimeSpan.Zero) return new("CAPTURE_TIMEOUT");
            var result = await pending.Completion.Task.WaitAsync(remaining, linked.Token);
            lock (sync) return provider.Available && !grant.CaptureRevoked.IsCancellationRequested
                ? result : new("CAPTURE_CANCELLED");
        }
        catch (TimeoutException) { return new("CAPTURE_TIMEOUT"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new("CAPTURE_CANCELLED"); }
        finally
        {
            lock (sync)
            {
                if (ReferenceEquals(provider.Pending, pending))
                {
                    provider.Pending = null;
                    SignalProviderChanged();
                }
                if (!pending.Completion.Task.IsCompleted)
                    provider.Events.Writer.TryWrite(new("CANCEL", pending.Request));
            }
        }
    }
}
