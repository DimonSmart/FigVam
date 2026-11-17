namespace FigVam.Application.Documents;

public sealed record SavedDocumentVersion(Guid Id, string? Name, DateTimeOffset Timestamp,
    string AuthorId, DocumentState Snapshot);
public sealed record DocumentVersionResult(string Code, SavedDocumentVersion? Version = null);
public sealed record DocumentVersionMetadata(Guid Id, string? Name, DateTimeOffset Timestamp,
    string AuthorId, long Revision);
public sealed record DocumentVersionListResult(string Code,
    IReadOnlyList<DocumentVersionMetadata>? Versions = null, long? NextBeforeRevision = null);

public interface IDocumentVersionStore
{
    Task<DocumentVersionListResult> ListVersionsAsync(Guid documentId, int limit, long? beforeRevision,
        CancellationToken cancellationToken = default);
    Task<DocumentVersionResult> ReadVersionAsync(Guid documentId, Guid versionId,
        CancellationToken cancellationToken = default);
}

public interface IDocumentVersionReader
{
    Task<DocumentVersionListResult> ListAsync(Guid documentId, DocumentActor actor, int limit = 50,
        long? beforeRevision = null, CancellationToken cancellationToken = default);
    Task<DocumentVersionResult> ReadAsync(Guid documentId, Guid versionId, DocumentActor actor,
        CancellationToken cancellationToken = default);
}

public sealed class DocumentVersionReader(IDocumentAuthorization authorization,
    IDocumentVersionStore store) : IDocumentVersionReader
{
    public async Task<DocumentVersionListResult> ListAsync(Guid documentId, DocumentActor actor, int limit = 50,
        long? beforeRevision = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanReadAsync(actor, documentId, cancellationToken))
            return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (limit is < 1 or > 100 || beforeRevision is <= 0) return new("INVALID_PAGE");
        return await store.ListVersionsAsync(documentId, limit, beforeRevision, cancellationToken);
    }

    public async Task<DocumentVersionResult> ReadAsync(Guid documentId, Guid versionId,
        DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanReadAsync(actor, documentId, cancellationToken))
            return new("FORBIDDEN");
        if (documentId == Guid.Empty || versionId == Guid.Empty) return new("INVALID_ID");
        return await store.ReadVersionAsync(documentId, versionId, cancellationToken);
    }
}
