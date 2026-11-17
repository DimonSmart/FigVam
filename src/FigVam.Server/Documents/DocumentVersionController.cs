using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;

namespace FigVam.Server.Documents;

public sealed record VersionMetadataResponse(Guid Id, string? Name, DateTimeOffset Timestamp, string AuthorId, long Revision);
public sealed record VersionHistoryResponse(IReadOnlyList<VersionMetadataResponse> Versions, long? NextBeforeRevision);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/versions")]
[Produces("application/json")]
public sealed class DocumentVersionController(IDocumentVersionReader reader) : ControllerBase
{
    /// <summary>List saved versions in descending revision order. Pass nextBeforeRevision as beforeRevision for the next page.</summary>
    [HttpGet, EndpointSummary("List saved document versions")]
    [ProducesResponseType<VersionHistoryResponse>(200)]
    [ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
    public async Task<IActionResult> List(Guid documentId, [FromQuery, Range(1, 100)] int limit = 50,
        [FromQuery, Range(1, long.MaxValue)] long? beforeRevision = null, CancellationToken cancellationToken = default)
    {
        if (Request.Query.Any(p => !new[] { "limit", "beforeRevision" }.Contains(p.Key, StringComparer.OrdinalIgnoreCase) || p.Value.Count != 1))
            return BadRequest(ApiErrors.Create(400, "INVALID_PAGE"));
        var result = await reader.ListAsync(documentId, User.GetDocumentActor(), limit, beforeRevision, cancellationToken);
        if (result.Code == "VERSIONS" && result.Versions is not null)
            return Ok(new VersionHistoryResponse(result.Versions.Select(v => new VersionMetadataResponse(v.Id, v.Name, v.Timestamp, v.AuthorId, v.Revision)).ToArray(), result.NextBeforeRevision));
        var status = result.Code switch { "FORBIDDEN" => 403, "INVALID_ID" or "INVALID_PAGE" => 400, _ => 500 };
        return StatusCode(status, ApiErrors.Create(status, status == 500 ? "INTERNAL_ERROR" : result.Code));
    }
}
