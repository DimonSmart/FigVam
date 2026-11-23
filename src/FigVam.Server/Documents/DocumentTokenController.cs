using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/tokens")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentTokenController(IDocumentTokenQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("List tokens at a document revision"), ProducesResponseType<TokenListResponse>(200)]
    public async Task<IActionResult> List(Guid documentId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (!ValidQuery("revision", "offset", "limit")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ListAsync(documentId, revision, offset, limit, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    [HttpGet("{tokenId}"), EndpointSummary("Read a token at a document revision"), ProducesResponseType<TokenResponse>(200)]
    public async Task<IActionResult> Read(Guid documentId, Guid tokenId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (!ValidQuery("revision")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadAsync(documentId, tokenId, revision, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    [HttpGet("{tokenId}/usages"), EndpointSummary("List direct and indirect token usages with resource dependency chains"), ProducesResponseType<TokenUsagesResponse>(200)]
    [EndpointDescription("Usages contain kind, ownerId, property, theme, indirect flag, owner label and a chain of IDs from the requested token to its consumer. Read against a specific revision for reproducible results.")]
    public async Task<IActionResult> Usages(Guid documentId, Guid tokenId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (!ValidQuery("revision", "offset", "limit")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.UsagesAsync(documentId, tokenId, revision, offset, limit, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    private bool ValidQuery(params string[] names) => Request.Query.All(k => names.Contains(k.Key, StringComparer.OrdinalIgnoreCase) && k.Value.Count == 1);
    private IActionResult Result<T>(string code, T? response) where T : class
    {
        if (response is not null) return Ok(response);
        var status = code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "TOKEN_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, code));
    }
}
