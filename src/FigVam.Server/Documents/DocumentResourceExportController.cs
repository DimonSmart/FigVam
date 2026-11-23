using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/resources")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401),
 ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404)]
public sealed class DocumentResourceExportController(IDocumentResourceExporter exporter) : ControllerBase
{
    [HttpGet("css"), EndpointSummary("Export revision-scoped neutral design resources and themed CSS declarations")]
    [ProducesResponseType<CssResourcesResponse>(200)]
    [EndpointDescription("Both theme values and original reference IDs are preserved in resources. Css uses explicit data-figvam-theme=Light/Dark selection, stable custom property names and reusable style classes. Null Css and diagnostics indicate an invalid or non-exportable document.")]
    public async Task<IActionResult> Css(Guid documentId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (Request.Query.Any(k => k.Value.Count != 1 ||
              !string.Equals(k.Key, "revision", StringComparison.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await exporter.ExportCssAsync(documentId, revision, User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var code = result.Code is "FORBIDDEN" ? 403 :
            result.Code is "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" ? 404 : 400;
        return StatusCode(code, ApiErrors.Create(code, result.Code));
    }
}
