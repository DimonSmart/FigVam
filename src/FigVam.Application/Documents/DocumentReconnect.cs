namespace FigVam.Application.Documents;

public sealed record CommittedDocumentEvent(Guid DocumentId, long Revision, Guid CommandId,
    string ActorId, string Type, DocumentEvent Payload)
{
    public string Source { get; init; } = "UI";
}

// Successful reads return either a complete contiguous event suffix or the current snapshot.
public sealed record DocumentReconnectResult(string Code, long? Revision = null,
    IReadOnlyList<CommittedDocumentEvent>? Events = null, DocumentState? Snapshot = null);

public interface IDocumentEventJournal
{
    Task<DocumentReconnectResult> ReadEventsAsync(Guid documentId, long lastSeenRevision,
        CancellationToken cancellationToken = default);
}

public interface IDocumentReconnectReader
{
    Task<DocumentReconnectResult> ReadAsync(Guid documentId, long lastSeenRevision,
        DocumentActor actor, CancellationToken cancellationToken = default);
}

public sealed class DocumentReconnectReader(IDocumentAuthorization authorization,
    IDocumentEventJournal journal) : IDocumentReconnectReader
{
    public async Task<DocumentReconnectResult> ReadAsync(Guid documentId, long lastSeenRevision,
        DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanReadAsync(actor, documentId, cancellationToken))
            return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (lastSeenRevision < 0) return new("INVALID_REVISION");
        return await journal.ReadEventsAsync(documentId, lastSeenRevision, cancellationToken);
    }
}
