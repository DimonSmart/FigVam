using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PresenceCursorRequest
{
    [Range(-10000000, 10000000)]
    public required double X { get; init; }
    [Range(-10000000, 10000000)]
    public required double Y { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PresenceUpdateRequest
{
    [Required, StringLength(128, MinimumLength = 1), RegularExpression(@".*\S.*")]
    public required string Name { get; init; }
    [Required, RegularExpression("^#[0-9a-fA-F]{6}$")]
    public required string Color { get; init; }
    public PresenceCursorRequest? Cursor { get; init; }
    [Required, MaxLength(100)]
    public required Guid[] SelectedIds { get; init; }
    public Guid? ScreenId { get; init; }
}

public sealed record PresenceUpdateResponse(string Code);
public sealed record PresenceParticipantsResponse(string Code, IReadOnlyList<PresenceParticipant> Participants);

[ApiController, Authorize, Route("api/v1/documents/{documentId}/presence")]
[Produces("application/json")]
public sealed class DocumentPresenceController(IDocumentPresence presence) : ControllerBase
{
    /// <summary>Replace the authenticated participant's ephemeral presence. It expires after one minute without an update.</summary>
    [HttpPut, EndpointSummary("Update document presence")]
    [ProducesResponseType<PresenceUpdateResponse>(200)]
    [ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(413), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
    public async Task<IActionResult> Update(Guid documentId, PresenceUpdateRequest request, CancellationToken cancellationToken)
    {
        var cursor = request.Cursor is null ? null : new PresenceCursor(request.Cursor.X, request.Cursor.Y);
        var result = await presence.UpdateAsync(documentId, User.GetDocumentActor(),
            new PresenceUpdate(request.Name, request.Color, cursor, request.SelectedIds, request.ScreenId), cancellationToken);
        return result.Code == "UPDATED" ? Ok(new PresenceUpdateResponse(result.Code)) : Error(result.Code);
    }

    /// <summary>Read up to 100 unexpired participants in actor ID order for this document.</summary>
    [HttpGet, EndpointSummary("Read document presence")]
    [ProducesResponseType<PresenceParticipantsResponse>(200)]
    [ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
    public async Task<IActionResult> Read(Guid documentId, CancellationToken cancellationToken)
    {
        var result = await presence.ReadAsync(documentId, User.GetDocumentActor(), cancellationToken);
        return result.Code == "PRESENCE" ? Ok(new PresenceParticipantsResponse(result.Code, result.Participants!)) : Error(result.Code);
    }

    private ObjectResult Error(string code)
    {
        var status = code switch { "FORBIDDEN" => 403, "INVALID_ID" or "INVALID_PRESENCE" => 400, _ => 500 };
        return StatusCode(status, ApiErrors.Create(status, status == 500 ? "INTERNAL_ERROR" : code));
    }
}
