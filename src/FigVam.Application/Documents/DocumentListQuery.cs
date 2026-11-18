namespace FigVam.Application.Documents;

public sealed record DocumentListItem(Guid DocumentId, string Name, string Role);
public sealed record DocumentListResponse(IReadOnlyList<DocumentListItem> Items, Guid? NextCursor);

public interface IDocumentListQuery
{
    Task<DocumentListResponse> ListAsync(DocumentActor actor, int limit = 50, Guid? cursor = null, CancellationToken cancellationToken = default);
}
