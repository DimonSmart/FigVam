using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/nodes/{nodeId}/repeater")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentRepeaterController(IDocumentRepeaterQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("Evaluate saved local repeater data at one document revision"), ProducesResponseType<RepeaterEvaluationResponse>(200)]
    [EndpointDescription("Returns relative scalar values by template node ID and item order, or the empty view ID for zero items. Offset is nonnegative and limit is 1–100. Missing or invalid fixture fields appear as diagnostics without changing the document. No live data is fetched.")]
    public async Task<IActionResult> Evaluate(Guid documentId, Guid nodeId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.EvaluateAsync(documentId, nodeId, revision, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "NODE_NOT_FOUND" or "REPEATER_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
