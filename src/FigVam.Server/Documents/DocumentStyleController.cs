using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

public sealed record StyleListResponse(Guid DocumentId, long Revision, IReadOnlyList<DesignStyle> Items,
    int Offset, int Limit, int Total);
public sealed record StyleUsagesResponse(Guid DocumentId, long Revision, Guid StyleId,
    IReadOnlyList<DesignResourceUse> Items, int Offset, int Limit, int Total);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/styles")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401),
 ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentStyleController(IDocumentAuthorization authorization, IDocumentStateReader reader) : ControllerBase
{
    [HttpGet("{styleId}/usages"), EndpointSummary("List direct and transitive style usages at a document revision")]
    [ProducesResponseType<StyleUsagesResponse>(200)]
    public async Task<IActionResult> Usages(Guid documentId, Guid styleId, [FromQuery] long? revision,
        [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => !new[] { "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase) ||
              q.Value.Count != 1) ||
            documentId == Guid.Empty || styleId == Guid.Empty || offset < 0 || limit is < 1 or > 100 || revision < 0)
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var actor = User.GetDocumentActor();
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct))
            return StatusCode(403, ApiErrors.Create(403, "FORBIDDEN"));
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state)
            return StatusCode(404, ApiErrors.Create(404, read.Code));
        if (!state.Document.Styles.Any(s => s.Id == styleId))
            return NotFound(ApiErrors.Create(404, "STYLE_NOT_FOUND"));
        var usages = new DesignResourceDependencies(state.Document).Usages("style", styleId);
        return Ok(new StyleUsagesResponse(documentId, state.Revision, styleId,
            usages.Skip(offset).Take(limit).ToArray(), offset, limit, usages.Count));
    }

    [HttpGet, EndpointSummary("List document design styles at a given revision"),
     ProducesResponseType<StyleListResponse>(200)]
    public async Task<IActionResult> List(Guid documentId, [FromQuery] long? revision,
        [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (Request.Query.Any(q => !new[] { "revision", "offset", "limit" }.Contains(q.Key, StringComparer.OrdinalIgnoreCase) ||
              q.Value.Count != 1))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        if (documentId == Guid.Empty || offset < 0 || limit is < 1 or > 100 || revision < 0)
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var actor = User.GetDocumentActor();
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct))
            return StatusCode(403, ApiErrors.Create(403, "FORBIDDEN"));
        var state = await reader.ReadAsync(documentId, revision, ct);
        if (state.State is null)
            return StatusCode(404, ApiErrors.Create(404, state.Code));
        var styles = state.State.Document.Styles;
        return Ok(new StyleListResponse(documentId, state.State.Revision,
            styles.Skip(offset).Take(limit).ToArray(), offset, limit, styles.Count));
    }
}
