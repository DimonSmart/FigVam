using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/scenarios")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentScenarioController(IDocumentScenarioQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("Read saved prototype scenarios at a consistent revision"), ProducesResponseType<ScenariosResponse>(200)]
    [EndpointDescription("Optional screenId and scenarioId filters. Offset is nonnegative; limit is 1-100. Revision is optional. Responses contain only local demo values saved by editors.")]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] Guid? screenId, [FromQuery] Guid? scenarioId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "screenId", "scenarioId", "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase))) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadAsync(documentId, screenId, scenarioId, revision, offset, limit, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCENARIO_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
