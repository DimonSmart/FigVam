using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/container.figvam")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403),
 ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(413), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentContainerExportController(IDocumentContainerExporter exporter) : ControllerBase
{
    [HttpGet, EndpointSummary("Export a standalone .figvam container"), ProducesResponseType(200, Type = typeof(FileContentResult))]
    [EndpointDescription("Exports the latest revision, a specified revision or a saved versionId (mutually exclusive). Owner/Editor only. Missing asset dependencies cause an explicit error. Manifest schema: /api/v1/schemas/manifest-v1.json.")]
    public async Task<IActionResult> Export(Guid documentId, [FromQuery] long? revision,
        [FromQuery] Guid? versionId, CancellationToken cancellationToken)
    {
        if (Request.Query.Any(k => k.Value.Count != 1 || !new[] { "revision", "versionId" }.Contains(k.Key, StringComparer.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await exporter.ExportAsync(documentId, revision, versionId, User.GetDocumentActor(), cancellationToken);
        if (result.Content is not null) return File(result.Content, "application/zip", "document.figvam");
        var status = result.Code switch
        {
            "FORBIDDEN" => 403,
            "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "VERSION_NOT_FOUND" => 404,
            "EXPORT_TOO_LARGE" => 413,
            _ => 400
        };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
