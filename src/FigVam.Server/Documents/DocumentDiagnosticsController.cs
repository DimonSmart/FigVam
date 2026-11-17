using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/diagnostics")]
[Produces("application/json")]
[ProducesResponseType<StructureDiagnosticsResponse>(200)]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentDiagnosticsController(IDocumentDiagnostics diagnostics) : ControllerBase
{
    [HttpGet, EndpointSummary("Validate the persisted document structure at a revision; optionally scope to a screen")]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] Guid? screenId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Keys.Any(k => !new[] { "screenId", "revision", "offset", "limit" }.Contains(k, StringComparer.OrdinalIgnoreCase)) || Request.Query.Any(k => k.Value.Count != 1))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await diagnostics.ReadAsync(documentId, screenId, revision, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "SCREEN_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
