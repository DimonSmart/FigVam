using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/screens/{screenId}/variants")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentScreenVariantController(IDocumentScreenVariantQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("Read saved screen variants and property differences at one revision"), ProducesResponseType<ScreenVariantsResponse>(200)]
    [EndpointDescription("Optional variantId selects one variant. Offset is nonnegative; limit is 1–100. Omitted overrides inherit base node properties. Component variants are independent entities.")]
    public async Task<IActionResult> Read(Guid documentId, Guid screenId, [FromQuery] Guid? variantId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "variantId", "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase))) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadAsync(documentId, screenId, variantId, revision, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
