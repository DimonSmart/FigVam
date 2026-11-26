using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Mcp;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/screen-capture")]
public sealed class ScreenCaptureController(ScreenCaptureService captures) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // A separate, targeted SSE stream uses the same authenticated HTTP transport as
    // collaboration. It is not a document event and must never enter the journal.
    [HttpPost("providers")]
    public async Task<IActionResult> Connect(Guid documentId, CancellationToken ct)
    {
        var actor = User.GetDocumentActor();
        if (!await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, actor.Id, ct))
            return Forbid();
        var sessionId = User.FindFirst("figvam_session")?.Value;
        var users = HttpContext.RequestServices.GetService<FigVamUserStore>();
        bool SessionActive() => sessionId is null || users?.IsActiveSession(actor.Id, sessionId) == true;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var duration = TimeSpan.FromHours(1);
        if (long.TryParse(User.FindFirst("exp")?.Value, out var expiry))
            duration = TimeSpan.FromSeconds(Math.Min(duration.TotalSeconds, expiry - DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        if (duration <= TimeSpan.Zero) return Unauthorized();
        lifetime.CancelAfter(duration);
        var provider = captures.Register(documentId, actor.Id, sessionId, Guid.Empty, [], lifetime.Token, SessionActive);
        if (provider is null) return Conflict(new { code = "RENDERER_UNAVAILABLE" });
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Accel-Buffering"] = "no";
        HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        async Task Send(object value)
        {
            using var write = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            write.CancelAfter(TimeSpan.FromSeconds(5));
            await Response.WriteAsync($"data: {JsonSerializer.Serialize(value, Json)}\n\n", write.Token);
            await Response.Body.FlushAsync(write.Token);
        }
        try
        {
            await Send(new { code = "READY", providerId = provider.Id });
            while (!lifetime.IsCancellationRequested)
            {
                if (!SessionActive() || !await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, actor.Id, lifetime.Token))
                    break;
                using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                heartbeat.CancelAfter(TimeSpan.FromSeconds(2));
                ScreenCaptureEvent message;
                try { message = await provider.Reader.ReadAsync(heartbeat.Token); }
                catch (OperationCanceledException) when (!lifetime.IsCancellationRequested)
                {
                    await Send(new { code = "HEARTBEAT" });
                    continue;
                }
                await Send(message);
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (System.Threading.Channels.ChannelClosedException) { }
        finally { captures.Disconnect(provider); }
        return new EmptyResult();
    }

    [HttpDelete("providers/{providerId:guid}")]
    public IActionResult Disconnect(Guid documentId, Guid providerId)
    {
        var provider = Find(documentId, providerId);
        if (provider is not null) captures.Disconnect(provider);
        return Ok(new { stopped = true });
    }

    [HttpPost("providers/{providerId:guid}/results/{requestId:guid}")]
    [RequestSizeLimit(8 * 1024 * 1024 + 1)]
    public async Task<IActionResult> Submit(Guid documentId, Guid providerId, Guid requestId,
        [FromQuery] Guid screenId, [FromQuery] long revision, [FromQuery] string? code, [FromQuery] string? theme, CancellationToken ct)
    {
        var provider = Find(documentId, providerId);
        if (provider is null || !captures.IsPending(provider, requestId)) return NotFound();
        if (!await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, provider.UserId, ct))
        {
            captures.Disconnect(provider);
            return Forbid();
        }
        ScreenCaptureResult result;
        if (code is not null && code != "OK")
            result = new(code is "SCREEN_NOT_DISPLAYED" or "RENDER_REVISION_MISMATCH" or "CAPTURE_CANCELLED" or "IMAGE_TOO_LARGE" or "CAPTURE_TIMEOUT"
                ? code : "CAPTURE_FAILED");
        else if (Request.ContentType != "image/png") result = new("CAPTURE_FAILED");
        else if (Request.ContentLength > ScreenCaptureResult.MaxPngBytes) result = new("IMAGE_TOO_LARGE");
        else
        {
            using var output = new MemoryStream();
            var buffer = new byte[81920];
            while (true)
            {
                var read = await Request.Body.ReadAsync(buffer.AsMemory(), ct);
                if (read == 0) break;
                if (output.Length + read > ScreenCaptureResult.MaxPngBytes)
                {
                    captures.Complete(provider, requestId, screenId, revision, new("IMAGE_TOO_LARGE"));
                    return Ok(new { accepted = true });
                }
                output.Write(buffer, 0, read);
            }
            result = ScreenCaptureResult.FromPng(output.ToArray()) with { Theme = theme };
        }
        return captures.Complete(provider, requestId, screenId, revision, result)
            ? Ok(new { accepted = true }) : NotFound();
    }

    private ScreenCaptureService.Provider? Find(Guid documentId, Guid providerId) =>
        captures.Find(providerId, documentId, User.GetDocumentActor().Id, User.FindFirst("figvam_session")?.Value);
}
