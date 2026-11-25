using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using FigVam.Server.Mcp;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents")]
[Produces("application/json")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(409)]
[ProducesResponseType<ApiError>(413), ProducesResponseType<ApiError>(415)]
[ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentController(IDocumentAccessService access, IDocumentListQuery documents) : ControllerBase
{
    /// <summary>List documents accessible to the authenticated actor, ordered by document ID.</summary>
    [HttpGet, ProducesResponseType<DocumentListResponse>(200)]
    [EndpointSummary("List accessible documents")]
    [EndpointDescription("Reads catalog metadata independently of document contents. Incompatible documents remain visible with their stored profile and compatibility issue. Legacy timestamps may be unknown; unreadable metadata is reported when membership can be verified. Only owners can delete documents using the revision-checked delete command.")]
    public async Task<ActionResult<DocumentListResponse>> List(
        [FromQuery, System.ComponentModel.DataAnnotations.Range(1, 100)] int limit = 50,
        [FromQuery] Guid? cursor = null, CancellationToken cancellationToken = default)
    {
        if (cursor == Guid.Empty) return BadRequest(ApiErrors.Create(400, "INVALID_CURSOR"));
        return Ok(await documents.ListAsync(User.GetDocumentActor(), limit, cursor, cancellationToken));
    }
    /// <summary>Create an empty document and grant its authenticated creator Owner access.</summary>
    [HttpPost, ProducesResponseType<DocumentAccessResponse>(201)]
    [EndpointSummary("Create an empty document owned by the authenticated actor")]
    public async Task<IActionResult> Create(CreateDocumentRequest request, CancellationToken cancellationToken)
        => Result(await access.CreateAsync(new(request.DocumentId, request.Name), User.GetDocumentActor(), cancellationToken), 201);

    /// <summary>Assign or replace a member role. Only an Owner may perform this operation.</summary>
    [HttpPut("{documentId}/members"), ProducesResponseType<DocumentAccessResponse>(200)]
    [EndpointSummary("Assign a member role (Owner only)")]
    public async Task<IActionResult> SetMember(Guid documentId, SetDocumentMemberRequest request, CancellationToken cancellationToken)
    {
        var memberId = request.MemberId;
        if (HttpContext.RequestServices.GetService<FigVamUserStore>() is { } users)
        {
            memberId = users.ResolveMember(memberId) ?? "";
            if (memberId.Length == 0) return BadRequest(ApiErrors.Create(400, "INVALID_MEMBER"));
        }
        var role = Enum.Parse<DocumentRole>(request.Role);
        var result = await access.SetMemberAsync(documentId, memberId, role, User.GetDocumentActor(), cancellationToken);
        if (result.Accepted && role == DocumentRole.Viewer)
            await HttpContext.RequestServices.GetRequiredService<McpAccessRegistry>().RevokeAsync(documentId, memberId, CancellationToken.None);
        return Result(result);
    }

    /// <summary>Remove a member. Only an Owner may perform this operation; the last Owner is retained.</summary>
    [HttpDelete("{documentId}/members/{memberId}"), ProducesResponseType<DocumentAccessResponse>(200)]
    [EndpointSummary("Remove a member (Owner only; the last Owner is retained)")]
    public async Task<IActionResult> RemoveMember(Guid documentId,
        [System.ComponentModel.DataAnnotations.StringLength(256, MinimumLength = 1)] string memberId,
        CancellationToken cancellationToken)
        => Result(await access.RemoveMemberAsync(documentId,
            HttpContext.RequestServices.GetService<FigVamUserStore>()?.ResolveMember(memberId, includeDisabled: true) ?? memberId,
            User.GetDocumentActor(), cancellationToken));

    private IActionResult Result(DocumentAccessResult result, int acceptedStatus = 200)
    {
        if (result.Accepted) return StatusCode(acceptedStatus, new DocumentAccessResponse(result.Code, result.DocumentId));
        var status = result.Code switch
        {
            "FORBIDDEN" => 403,
            "DOCUMENT_EXISTS" or "LAST_OWNER" => 409,
            "INVALID_DOCUMENT_NAME" or "INVALID_ID" or "INVALID_MEMBER" or "INVALID_ROLE" => 400,
            _ => 500
        };
        return StatusCode(status, ApiErrors.Create(status, status == 500 ? "INTERNAL_ERROR" : result.Code));
    }
}

