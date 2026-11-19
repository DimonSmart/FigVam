using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/scenario-capabilities")]
[Produces("application/json")]
public sealed class ScenarioCapabilitiesController(IScenarioCapabilitiesQuery query) : ControllerBase
{
    [HttpGet, EndpointSummary("Read profile-supported scenario choices for a node and target at a document revision"), ProducesResponseType<ScenarioCapabilitiesResponse>(200)]
    [EndpointDescription("The returned actions are evaluated for the supplied target. Events are evaluated for the node kind. Requery when the revision, node, target, screen or variant changes; command validation remains authoritative.")]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] long revision, [FromQuery] Guid nodeId, [FromQuery] Guid? targetId, [FromQuery] Guid? screenId, [FromQuery] Guid? variantId, CancellationToken ct)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "revision", "nodeId", "targetId", "screenId", "variantId" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase))) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await query.ReadAsync(documentId, revision, nodeId, targetId, screenId, variantId, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "NODE_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
