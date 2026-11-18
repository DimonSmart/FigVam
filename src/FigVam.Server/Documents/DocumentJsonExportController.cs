using FigVam.Application.Documents;
using System.Text.Json;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/document.json")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403),
 ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(413), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentJsonExportController(IDocumentJsonExporter exporter) : ControllerBase
{
    [HttpGet, EndpointSummary("Export a standalone document.json"), ProducesResponseType<JsonElement>(200)]
    [EndpointDescription("Exports format version 1, at the latest revision or a specified revision or saved versionId (mutually exclusive). Owner/Editor only. At most 16 MiB. Excludes remote live data and server secrets. Schema: /api/v1/schemas/document-v1.json. Missing asset dependencies and unsupported data cause explicit errors without partial output.")]
    public async Task<IActionResult> Export(Guid documentId, [FromQuery] long? revision,
        [FromQuery] Guid? versionId, CancellationToken cancellationToken)
    {
        if (Request.Query.Any(k => k.Value.Count != 1 || !new[] { "revision", "versionId" }.Contains(k.Key, StringComparer.OrdinalIgnoreCase)))
            return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await exporter.ExportAsync(documentId, revision, versionId, User.GetDocumentActor(), cancellationToken);
        if (result.Content is not null) return File(result.Content, "application/json", "document.json");
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
