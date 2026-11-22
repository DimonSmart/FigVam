using FigVam.Application.Documents;
using FigVam.Domain.Preview;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

public sealed record PreviewPlaybackRequest(long Revision, PreviewSelection Selection, IReadOnlyList<PreviewTrigger> Triggers);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/preview")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentPreviewController(IDocumentPreviewFactory previewFactory) : ControllerBase
{
    [HttpPost, RequestSizeLimit(16 * 1024), ProducesResponseType<DocumentPreview>(200)]
    [EndpointSummary("Replay a bounded sequence of saved prototype events without mutating the document")]
    public async Task<IActionResult> Replay(Guid documentId, PreviewPlaybackRequest request, CancellationToken ct)
    {
        var result = await previewFactory.ReplayAsync(documentId, request.Revision, request.Selection, request.Triggers,
            User.GetDocumentActor(), ct);
        if (result.Preview is { } preview) return Ok(preview);
        var status = result.Code switch
        {
            "FORBIDDEN" => 403,
            "DOCUMENT_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404,
            _ => 400
        };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
