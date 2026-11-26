using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using FigVam.Server.Mcp;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/events")]
public sealed class DocumentSubscriptionController(IDocumentReconnectReader reader,
    IDocumentSubscriptions subscriptions, DocumentSubscriptionLimits limits) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Stream committed changes as SSE after lastSeenRevision. On RECONNECT_REQUIRED or EOF use reconnect, then subscribe from the recovered revision.</summary>
    /// <remarks>Bearer header required. Data is DocumentSubscriptionMessage JSON. Only CHANGE advances the cursor; its SSE id equals revision. READY and HEARTBEAT do not confirm new state. FORBIDDEN terminates after access revocation. No Last-Event-ID or query tokens. Maximum 5 streams per actor and 128 per process, 5 second write deadline, 1 hour lifetime bounded by token expiry. Journal polling interval is 100 ms.</remarks>
    [HttpGet, EndpointSummary("Subscribe to committed document changes")]
    [EndpointDescription("SSE frames: event is the code, data is DocumentSubscriptionMessage JSON. READY opens the requested cursor; CHANGE carries a committed event and its SSE id equals revision; HEARTBEAT does not advance the cursor. FORBIDDEN terminates on revoked read access. On RECONNECT_REQUIRED, EOF or a revision gap call GET reconnect with the last applied revision, apply its events/snapshot and subscribe from the resulting revision. Requires Authorization bearer header; only lastSeenRevision is accepted in query. Last-Event-ID is ignored. Ordered shared-journal polling every 100ms; limits: 5 streams per actor, 128 per process, 5s write deadline, 1h/token-expiry lifetime. No exactly-once network delivery guarantee.")]
    [ProducesResponseType<DocumentSubscriptionMessage>(200, "text/event-stream")]
    [ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] long? lastSeenRevision, CancellationToken cancellationToken)
    {
        if (Request.Query.Count != 1 || !Request.Query.TryGetValue("lastSeenRevision", out var value) || value.Count != 1 || lastSeenRevision is null)
            return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        var actor = User.GetDocumentActor();
        using var lease = limits.TryAcquire(actor.Id);
        if (lease is null) return StatusCode(429, ApiErrors.Create(429));
        var initialCode = (await reader.ReadAsync(documentId, lastSeenRevision.Value, actor, cancellationToken)).Code;
        if (initialCode is not ("EVENTS" or "SNAPSHOT"))
        {
            var status = initialCode switch { "FORBIDDEN" => 403, "INVALID_ID" or "INVALID_REVISION" => 400, "DOCUMENT_NOT_FOUND" => 404, _ => 500 };
            return StatusCode(status, ApiErrors.Create(status, status == 500 ? "INTERNAL_ERROR" : initialCode));
        }
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var duration = TimeSpan.FromHours(1);
        if (long.TryParse(User.FindFirst("exp")?.Value, out var expiry))
            duration = TimeSpan.FromSeconds(Math.Min(duration.TotalSeconds, expiry - DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        if (duration <= TimeSpan.Zero) return Unauthorized(ApiErrors.Create(401));
        lifetime.CancelAfter(duration);
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Accel-Buffering"] = "no";
        HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        async Task Send(string code, object payload, long? revision = null)
        {
            using var write = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            write.CancelAfter(TimeSpan.FromSeconds(5));
            var id = revision is { } cursor ? $"id: {cursor}\n" : "";
            await Response.WriteAsync($"{id}event: {code}\ndata: {JsonSerializer.Serialize(payload, Json)}\n\n", write.Token);
            await Response.Body.FlushAsync(write.Token);
        }
        try
        {
            // This opt-in extension does not change the ordinary subscription
            // contract. Capture control frames never enter the document journal.
            if (Request.Headers["X-FigVam-Screen-Capture"] == "1")
                await ReadWithCaptureAsync(documentId, lastSeenRevision.Value, actor, lifetime, Send);
            else
                await foreach (var message in subscriptions.ReadAsync(documentId, lastSeenRevision.Value, actor, lifetime.Token))
                    await Send(message.Code, message, message.Code == "CHANGE" ? message.Revision : null);
        }
        catch (OperationCanceledException) { HttpContext.Abort(); }
        catch (IOException) { HttpContext.Abort(); }
        return new EmptyResult();
    }

    private async Task ReadWithCaptureAsync(Guid documentId, long revision, DocumentActor actor,
        CancellationTokenSource lifetime, Func<string, object, long?, Task> send)
    {
        var ct = lifetime.Token;
        var services = HttpContext.RequestServices;
        var captures = services.GetRequiredService<ScreenCaptureService>();
        var sessionId = User.FindFirst("figvam_session")?.Value;
        var users = services.GetService<FigVamUserStore>();
        bool SessionActive() => sessionId is null || users?.IsActiveSession(actor.Id, sessionId) == true;
        ScreenCaptureService.Provider? provider = null;
        if (SessionActive() && await McpServiceRegistration.CanEditAsync(services, documentId, actor.Id, ct))
            provider = captures.Register(documentId, actor.Id, sessionId, ct, SessionActive, reconnectable: true);
        await using var messages = subscriptions.ReadAsync(documentId, revision, actor, ct).GetAsyncEnumerator(ct);
        Task<bool>? nextMessage = null;
        Task<bool>? nextCapture = null;
        try
        {
            if (provider is not null)
                await send("SCREEN_CAPTURE_READY", new { code = "SCREEN_CAPTURE_READY", providerId = provider.Id }, null);
            nextMessage = messages.MoveNextAsync().AsTask();
            nextCapture = provider?.Reader.WaitToReadAsync(ct).AsTask();
            while (!ct.IsCancellationRequested)
            {
                if (nextCapture is not null)
                    await Task.WhenAny(nextMessage, nextCapture);
                else
                    await nextMessage;

                if (nextMessage.IsCompleted)
                {
                    if (!await nextMessage) break;
                    var message = messages.Current;
                    await send(message.Code, message, message.Code == "CHANGE" ? message.Revision : null);
                    if (message.Code is "FORBIDDEN" or "RECONNECT_REQUIRED") break;
                    if (provider is not null && (!SessionActive() ||
                        !await McpServiceRegistration.CanEditAsync(services, documentId, actor.Id, ct)))
                    {
                        captures.Disconnect(provider);
                        provider = null;
                        nextCapture = null;
                    }
                    nextMessage = messages.MoveNextAsync().AsTask();
                }

                if (provider is not null && nextCapture?.IsCompleted == true)
                {
                    if (!await nextCapture || !SessionActive() ||
                        !await McpServiceRegistration.CanEditAsync(services, documentId, actor.Id, ct))
                    {
                        captures.Disconnect(provider);
                        provider = null;
                        nextCapture = null;
                        continue;
                    }
                    if (provider.Reader.TryRead(out var capture))
                    {
                        var code = "SCREEN_CAPTURE_" + capture.Code;
                        await send(code, new { code, request = capture.Request }, null);
                    }
                    nextCapture = provider.Reader.WaitToReadAsync(ct).AsTask();
                }
            }
        }
        finally
        {
            // Finish the outstanding MoveNext before disposing the async iterator.
            lifetime.Cancel();
            if (provider is not null) captures.Disconnect(provider);
            if (nextMessage is not null)
                try { await nextMessage; } catch (OperationCanceledException) { }
            if (nextCapture is not null)
                try { await nextCapture; } catch (OperationCanceledException) { }
        }
    }

}

