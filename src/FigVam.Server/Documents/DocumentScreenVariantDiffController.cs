using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/screens/{screenId}/variant-diff")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentScreenVariantDiffController(IDocumentScreenVariantDiff query) : ControllerBase
{
    [HttpGet, EndpointSummary("Compare effective screen variant properties"), ProducesResponseType<ScreenVariantDiffResponse>(200)]
    [EndpointDescription("Omit either variant ID to select the base state. Both variants must belong to the specified screen at the selected revision. Results contain node IDs and property names only, ordered by node ID and property. Offset is nonnegative and limit is 1-100.")]
    public async Task<IActionResult> Compare(Guid documentId, Guid screenId, [FromQuery] Guid? fromVariantId, [FromQuery] Guid? toVariantId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "fromVariantId", "toVariantId", "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase))) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await query.CompareAsync(documentId, screenId, fromVariantId, toVariantId, revision, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
