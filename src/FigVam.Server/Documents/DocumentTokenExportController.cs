using FigVam.Application.Documents;
using FigVam.Domain.Tokens;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/token-export")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentTokenExportController(IDocumentTokenExporter exporter) : ControllerBase
{
    [HttpGet, EndpointSummary("Export design tokens in DTCG 2025.10 format"), ProducesResponseType<TokenExportResponse>(200)]
    [EndpointDescription("Select Light or Dark, optionally by revision. DTCG 2025.10 includes nested groups, typography, token aliases, and org.figvam metadata for stable IDs, legacy types and semantic categories. A null tokens object and diagnostics mean lossless export is impossible. At most 1000 tokens and 1 MiB of token JSON are supported.")]
    public async Task<IActionResult> Export(Guid documentId, [FromQuery] string? theme, [FromQuery] long? revision, CancellationToken ct)
    {
        if (Request.Query.Any(k => k.Value.Count != 1 || !new[] { "theme", "revision" }.Contains(k.Key, StringComparer.OrdinalIgnoreCase)) ||
            theme is not ("Light" or "Dark")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await exporter.ExportAsync(documentId, revision, Enum.Parse<TokenTheme>(theme), User.GetDocumentActor(), ct);
        if (result.Response is not null) return Ok(result.Response);
        var status = result.Code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, result.Code));
    }
}
