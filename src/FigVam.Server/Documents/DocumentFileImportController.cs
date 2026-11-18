using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/import")]
[ProducesResponseType<DocumentImportResponse>(201), ProducesResponseType<DocumentImportFailure>(400)]
[ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(409)]
[ProducesResponseType<ApiError>(413), ProducesResponseType<ApiError>(415)]
[ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentFileImportController(IDocumentFileImporter importer) : ControllerBase
{
    [HttpPost("document.json"), Consumes("application/json"), RequestSizeLimit(DocumentJsonFormat.MaxBytes)]
    [EndpointSummary("Reopen a version-1 document.json as a new document")]
    [EndpointDescription("Raw document-v1.json schema body, at most 16777216 bytes. Preserves document and technical IDs; authenticated actor becomes Owner. Creates local revision 0 without source versions, members or command history. Existing ID returns 409 without modification. Validation diagnostics include codes and paths.")]
    public Task<IActionResult> Json(CancellationToken cancellationToken)
        => Import(DocumentFileFormat.Json, cancellationToken);

    [HttpPost("container.figvam"), Consumes("application/zip"), RequestSizeLimit(DocumentFileReader.MaxContainerBytes)]
    [EndpointSummary("Reopen a version-1 .figvam container as a new document")]
    [EndpointDescription("Raw ZIP body, at most 84148224 bytes. Contains manifest.json, document.json and selected safe PNG assets. Validates paths, bounds, schemas, references, sizes, hashes and raster metadata before atomically storing all content, revision zero and Owner. No multipart envelope.")]
    public Task<IActionResult> Container(CancellationToken cancellationToken)
        => Import(DocumentFileFormat.FigVam, cancellationToken);

    private async Task<IActionResult> Import(DocumentFileFormat format, CancellationToken cancellationToken)
    {
        var limit = format == DocumentFileFormat.Json ? DocumentJsonFormat.MaxBytes : DocumentFileReader.MaxContainerBytes;
        if (Request.ContentLength > limit) return StatusCode(413, ApiErrors.Create(413, "FILE_TOO_LARGE"));
        var result = await importer.ImportAsync(new(format, Request.Body), User.GetDocumentActor(), cancellationToken);
        if (result.Code == "ACCEPTED") return StatusCode(201, new DocumentImportResponse(result.Code, result.DocumentId, 0));
        var status = result.Code switch
        {
            "FORBIDDEN" => 403, "DOCUMENT_EXISTS" => 409, "FILE_TOO_LARGE" => 413, _ => 400
        };
        return status == 400 && result.Diagnostics is { } diagnostics
            ? StatusCode(status, new DocumentImportFailure(result.Code, diagnostics))
            : StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
