namespace FigVam.Application.Documents;

public sealed record DocumentListItem(Guid DocumentId, string Name, string Role)
{
    public int? StorageSchemaVersion { get; init; }
    public string? ProfileId { get; init; }
    public int? ProfileVersion { get; init; }
    public int CurrentProfileVersion { get; init; }
    public long? Revision { get; init; }
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
    public string? CompatibilityIssue { get; init; }
}
public sealed record DocumentListResponse(IReadOnlyList<DocumentListItem> Items, Guid? NextCursor);

public interface IDocumentListQuery
{
    Task<DocumentListResponse> ListAsync(DocumentActor actor, int limit = 50, Guid? cursor = null, CancellationToken cancellationToken = default);
}
