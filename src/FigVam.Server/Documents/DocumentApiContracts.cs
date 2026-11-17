using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace FigVam.Server.Documents;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateDocumentRequest
{
    public required Guid DocumentId { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetDocumentMemberRequest
{
    [Required, StringLength(256, MinimumLength = 1)]
    public required string MemberId { get; init; }
    [Required, RegularExpression("^(Owner|Editor|Viewer)$")]
    public required string Role { get; init; }
}

public sealed record DocumentAccessResponse(string Code, Guid DocumentId);

public sealed record ApiError(string Type, string Title, int Status, string Code, string Detail, Guid? NodeId = null, string? Property = null, IReadOnlyList<FigVam.Application.Documents.TokenImportDiagnostic>? Diagnostics = null);
