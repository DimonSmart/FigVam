using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/components")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentComponentController(IDocumentComponentQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("Search component definitions at a document revision"), ProducesResponseType<ComponentListResponse>(200)]
    public async Task<IActionResult> List(Guid documentId, [FromQuery] long? revision, [FromQuery] string? search, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (!ValidQuery("revision", "search", "offset", "limit")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ListAsync(documentId, revision, search, offset, limit, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    [HttpGet("{componentId}"), EndpointSummary("Read a component definition at a document revision"), ProducesResponseType<ComponentResponse>(200)]
    public async Task<IActionResult> Read(Guid documentId, Guid componentId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (!ValidQuery("revision")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadAsync(documentId, componentId, revision, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    [HttpGet("{componentId}/usages"), EndpointSummary("List component instances at a document revision"), ProducesResponseType<ComponentUsagesResponse>(200)]
    public async Task<IActionResult> Usages(Guid documentId, Guid componentId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (!ValidQuery("revision", "offset", "limit")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.UsagesAsync(documentId, componentId, revision, offset, limit, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }
    private bool ValidQuery(params string[] names) => Request.Query.All(k => names.Contains(k.Key, StringComparer.OrdinalIgnoreCase) && k.Value.Count == 1);
    private IActionResult Result<T>(string code, T? response) where T : class
    {
        if (response is not null) return Ok(response);
        var status = code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "COMPONENT_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, code));
    }
}
