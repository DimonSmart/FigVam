using FigVam.Application.Documents;
using FigVam.Domain.Tokens;
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
    [HttpGet("profile"), EndpointSummary("Read the Portable UI Profile capabilities at a document revision")]
    [ProducesResponseType<DocumentProfileResponse>(200)]
    public async Task<IActionResult> Profile(Guid documentId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (Request.Query.Keys.Any(key => !string.Equals(key, "revision", StringComparison.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        if (Request.Query.TryGetValue("revision", out var revisions) && (revisions.Count != 1 || revision is null))
            return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        var result = await queries.ReadProfileAsync(documentId, revision, User.GetDocumentActor(), ct);
        if (result.Response is { } response) return Ok(response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
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
    [HttpGet("screens/{screenId}/layout"), EndpointSummary("Read reference bounds, clipping and layout diagnostics for a screen")]
    [ProducesResponseType<ScreenLayoutResponse>(200)]
    public async Task<IActionResult> ScreenLayout(Guid documentId, Guid screenId, CancellationToken ct,
        [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 100,
        [FromQuery] double? previewWidth = null, [FromQuery] double? previewHeight = null,
        [FromQuery] Guid? variantId = null, [FromQuery] Guid? datasetId = null, [FromQuery] TokenTheme theme = TokenTheme.Light)
    {
        if (Request.Query.TryGetValue("revision", out var revisions) && (revisions.Count != 1 || revision is null))
            return BadRequest(ApiErrors.Create(400, "INVALID_REVISION"));
        if (previewWidth.HasValue != previewHeight.HasValue || Request.Query.Any(parameter =>
                !new[] { "revision", "offset", "limit", "previewWidth", "previewHeight", "variantId", "datasetId", "theme" }
                    .Contains(parameter.Key, StringComparer.OrdinalIgnoreCase) ||
                parameter.Value.Count != 1))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var viewport = previewWidth is { } width && previewHeight is { } height
            ? new FigVam.Domain.Documents.ScreenDimensions(width, height) : null;
        var result = await queries.ReadScreenLayoutAsync(documentId,
            new(screenId, revision, offset, limit, viewport, variantId, datasetId, theme), User.GetDocumentActor(), ct);
        if (result.Response is { } response) return Ok(response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or
            "SCREEN_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "DATASET_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
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

