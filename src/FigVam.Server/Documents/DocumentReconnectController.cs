using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

public sealed record ReconnectResponse(string Code, long Revision,
    IReadOnlyList<CommittedDocumentEvent>? Events, DocumentState? Snapshot);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/reconnect")]
[Produces("application/json")]
public sealed class DocumentReconnectController(IDocumentReconnectReader reader) : ControllerBase
{
    /// <summary>Read a complete ordered suffix after lastSeenRevision, or a current consistent snapshot.</summary>
    [HttpGet, EndpointSummary("Recover document changes")]
    [ProducesResponseType<ReconnectResponse>(200)]
    [ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] long? lastSeenRevision, CancellationToken cancellationToken)
    {
        if (Request.Query.Count != 1 || !Request.Query.TryGetValue("lastSeenRevision", out var value) || value.Count != 1 || lastSeenRevision is null)
            return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        var result = await reader.ReadAsync(documentId, lastSeenRevision.Value, User.GetDocumentActor(), cancellationToken);
        if (result.Code is "EVENTS" or "SNAPSHOT" && result.Revision is { } revision)
            return Ok(new ReconnectResponse(result.Code, revision, result.Events, result.Snapshot));
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" => 404, "INVALID_ID" or "INVALID_REVISION" => 400, _ => 500 };
        return StatusCode(status, ApiErrors.Create(status, status == 500 ? "INTERNAL_ERROR" : result.Code));
    }
}
