using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/datasets")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentDatasetController(IDocumentDatasetQueries queries) : ControllerBase
{
    [HttpGet, EndpointSummary("List dataset metadata at a document revision"), ProducesResponseType<DatasetListResponse>(200)]
    [EndpointDescription("Returns metadata without fixture contents. Offset must be nonnegative; limit is 1–100 (default 50).")]
    public async Task<IActionResult> List(Guid documentId, [FromQuery] long? revision, [FromQuery] int offset = 0, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        if (!ValidQuery("revision", "offset", "limit")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ListAsync(documentId, revision, offset, limit, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }

    [HttpGet("{datasetId}"), EndpointSummary("Read dataset metadata at a document revision"), ProducesResponseType<DatasetResponse>(200)]
    public async Task<IActionResult> Read(Guid documentId, Guid datasetId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (!ValidQuery("revision")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadAsync(documentId, datasetId, revision, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }

    [HttpGet("{datasetId}/fixture"), EndpointSummary("Read saved offline JSON fixture at a document revision"), ProducesResponseType<DatasetFixtureResponse>(200)]
    [EndpointDescription("Explicitly returns the saved local fixture as a JSON string (maximum 65536 UTF-8 bytes, depth 32). No remote data is fetched.")]
    public async Task<IActionResult> Fixture(Guid documentId, Guid datasetId, [FromQuery] long? revision, CancellationToken ct)
    {
        if (!ValidQuery("revision")) return BadRequest(ApiErrors.Create(400, "INVALID_QUERY"));
        var result = await queries.ReadFixtureAsync(documentId, datasetId, revision, User.GetDocumentActor(), ct);
        return Result(result.Code, result.Response);
    }

    private bool ValidQuery(params string[] names) => Request.Query.All(k => names.Contains(k.Key, StringComparer.OrdinalIgnoreCase) && k.Value.Count == 1);
    private IActionResult Result<T>(string code, T? response) where T : class
    {
        if (response is not null) return Ok(response);
        var status = code switch { "FORBIDDEN" => 403, "REVISION_UNAVAILABLE" or "DOCUMENT_NOT_FOUND" or "DATASET_NOT_FOUND" => 404, _ => 400 };
        return StatusCode(status, ApiErrors.Create(status, code));
    }
}
