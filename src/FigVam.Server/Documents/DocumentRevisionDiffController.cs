using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/revision-diff")]
[Produces("application/json")]
[ProducesResponseType<RevisionDiffResponse>(200)]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentRevisionDiffController(IDocumentRevisionDiff diff) : ControllerBase
{
    [HttpGet, EndpointSummary("Compare two document revisions")]
    public async Task<IActionResult> Compare(Guid documentId, [FromQuery] long? fromRevision, [FromQuery] long? toRevision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Keys.Any(k => !new[] { "fromRevision", "toRevision", "offset", "limit" }.Contains(k, StringComparer.OrdinalIgnoreCase)) || Request.Query.Any(k => k.Value.Count != 1))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        if (fromRevision is null || toRevision is null) return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        var result = await diff.CompareAsync(documentId, fromRevision.Value, toRevision.Value, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
