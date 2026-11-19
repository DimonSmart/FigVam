using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

public sealed record ScenarioCapabilitiesValueRequest([property: System.Text.Json.Serialization.JsonRequired] string? DemoValue);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/scenario-capabilities")]
[Produces("application/json")]
public sealed class ScenarioCapabilitiesController(IScenarioCapabilitiesQuery query) : ControllerBase
{
    [HttpPost, EndpointSummary("Read profile-supported scenario choices for a node and target at a document revision"), ProducesResponseType<ScenarioCapabilitiesResponse>(200)]
    [EndpointDescription("The returned actions are evaluated for the supplied target. Events are evaluated for the node kind. Requery when the revision, node, target, screen, variant, dataset, demo node or demo value changes. Supply demoValue in the JSON body, including null or an empty string; command validation remains authoritative.")]
    public async Task<IActionResult> Read(Guid documentId, [FromQuery] long revision, [FromQuery] Guid nodeId, [FromQuery] Guid? targetId, [FromQuery] Guid? screenId, [FromQuery] Guid? variantId, [FromQuery] Guid? datasetId, [FromQuery] Guid? demoNodeId, [FromBody] ScenarioCapabilitiesValueRequest value, CancellationToken ct)
    {
        if (Request.Query.Any(q => q.Value.Count != 1 || !new[] { "revision", "nodeId", "targetId", "screenId", "variantId", "datasetId", "demoNodeId" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase))) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await query.ReadAsync(documentId, revision, nodeId, targetId, screenId, variantId, datasetId, demoNodeId, value.DemoValue, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "DOCUMENT_NOT_FOUND" or "NODE_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "DATASET_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
