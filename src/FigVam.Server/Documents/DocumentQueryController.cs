using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}")]
[Produces("application/json")]
[ProducesResponseType<StructureResponse>(200)]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentQueryController(IDocumentStructureQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("Read a document at the requested or current revision")]
    public Task<IActionResult> Document(Guid documentId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "document", null, options, ct);
    [HttpGet("pages"), EndpointSummary("List document pages")]
    public Task<IActionResult> Pages(Guid documentId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "pages", null, options, ct);
    [HttpGet("pages/{pageId}"), EndpointSummary("Read a page")]
    public Task<IActionResult> Page(Guid documentId, Guid pageId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "page", pageId, options, ct);
    [HttpGet("pages/{pageId}/screens"), EndpointSummary("List ordered screens on a page") ]
    public Task<IActionResult> PageScreens(Guid documentId, Guid pageId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "page-screens", pageId, options, ct);
    [HttpGet("screens"), EndpointSummary("List document screens")]
    public Task<IActionResult> Screens(Guid documentId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "screens", null, options, ct);
    [HttpGet("screens/{screenId}"), EndpointSummary("Read a screen")]
    public Task<IActionResult> Screen(Guid documentId, Guid screenId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "screen", screenId, options, ct);
    [HttpGet("nodes"), EndpointSummary("List document nodes")]
    public Task<IActionResult> Nodes(Guid documentId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "nodes", null, options, ct);
    [HttpGet("nodes/{nodeId}"), EndpointSummary("Read a node")]
    public Task<IActionResult> Node(Guid documentId, Guid nodeId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "node", nodeId, options, ct);
    [HttpGet("children/{parentId}"), EndpointSummary("List ordered children of a screen or node")]
    public Task<IActionResult> Children(Guid documentId, Guid parentId, [FromQuery] QueryOptions options, CancellationToken ct) => Read(documentId, "children", parentId, options, ct);

    private async Task<IActionResult> Read(Guid documentId, string resource, Guid? id, QueryOptions options, CancellationToken ct)
    {
        if (Request.Query.Keys.Any(k => !new[] { "offset", "limit", "depth", "fields", "screenId", "kind", "semanticKey", "namePrefix", "revision" }.Contains(k, StringComparer.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        if (Request.Query.TryGetValue("revision", out var revisions) && (revisions.Count != 1 || options.Revision is null))
            return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        var result = await queries.QueryAsync(documentId, new(resource, id, options.Offset, options.Limit, options.Depth, options.Fields, options.ScreenId, options.Kind, options.SemanticKey, options.NamePrefix, options.Revision), User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "PAGE_NOT_FOUND" or "SCREEN_NOT_FOUND" or "NODE_NOT_FOUND" or "PARENT_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}

public sealed class QueryOptions
{
    [System.ComponentModel.Description("Committed document revision to read; omitted selects the current revision.")]
    public long? Revision { get; set; }
    public int Offset { get; set; }
    public int Limit { get; set; } = 50;
    public int Depth { get; set; }
    public string? Fields { get; set; }
    public Guid? ScreenId { get; set; }
    public string? Kind { get; set; }
    [System.ComponentModel.DataAnnotations.StringLength(256)]
    public string? SemanticKey { get; set; }
    [System.ComponentModel.DataAnnotations.StringLength(256)]
    public string? NamePrefix { get; set; }
}

