using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// The staging scope is never registered as a service or shared across requests.
// The durable journal sees only the final patch and result.
public sealed record BatchApplied(DocumentPatch Patch) : DocumentEvent;
public interface IDocumentBatchJournal
{
    Task<CommandResult> ExecuteBatchAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Task<DocumentChange>> apply, CancellationToken cancellationToken,
        Func<ValueTask<CommandResult?>> authorize);
}
public sealed record BatchExecution(string Code, string Response);

public sealed class DocumentBatchExecutor(IDocumentAuthorization authorization, IDocumentBatchJournal journal, INodeProfile profile)
{
    public async Task<CommandResult> ExecuteAsync(Guid documentId, Guid commandId, long expectedRevision,
        DocumentActor actor, Func<DocumentBatchScope, Task<BatchExecution>> apply, CancellationToken ct = default)
    {
        CommandResult Result(string code, long? revision = null, string? response = null) =>
            new(documentId, commandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow)
                { Source = actor.Source, BatchResponse = response };
        if (documentId == Guid.Empty || commandId == Guid.Empty) return Result("INVALID_ID");
        if (expectedRevision < 0) return Result("INVALID_REVISION");
        if (!await authorization.CanEditAsync(actor, documentId, ct)) return Result("FORBIDDEN");
        return await journal.ExecuteBatchAsync(documentId, commandId, async original =>
        {
            if (original is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (original.Revision != expectedRevision) return new(Result("REVISION_CONFLICT", original.Revision), null);
            var scope = new DocumentBatchScope(original, actor, authorization, profile);
            var outcome = await apply(scope);
            ct.ThrowIfCancellationRequested();
            if (outcome.Code != "ACCEPTED")
                return new(Result(outcome.Code, original.Revision, outcome.Response), null);
            var next = scope.State with { Revision = checked(original.Revision + 1) };
            return new(Result("ACCEPTED", next.Revision, outcome.Response), next,
                new BatchApplied(DocumentPatch.Between(original.Document, next.Document)));
        }, ct, async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }
}

public sealed class DocumentBatchScope : IDocumentCommandJournal, IDocumentStateReader, IDocumentCommandResultReader
{
    private readonly DocumentActor actor;
    public DocumentState State { get; private set; }
    public IDocumentCommandHandler Handler { get; }
    public IDocumentTokenQueries TokenQueries { get; }

    internal DocumentBatchScope(DocumentState state, DocumentActor actor, IDocumentAuthorization authorization, INodeProfile profile)
    {
        State = state;
        this.actor = actor;
        Handler = new DocumentCommandHandler(authorization, this, profile);
        TokenQueries = new DocumentTokenQueries(authorization, this);
    }

    public Task<DocumentStateReadResult> ReadAsync(Guid documentId, long? revision, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(documentId == State.Document.Id && (revision is null || revision == State.Revision)
            ? new DocumentStateReadResult("OK", State) : new DocumentStateReadResult("DOCUMENT_NOT_FOUND"));
    }

    public Task<CommandResult?> ReadResultAsync(Guid documentId, Guid commandId, DocumentActor actor,
        CancellationToken cancellationToken = default) => Task.FromResult<CommandResult?>(null);

    public async Task<CommandResult> ExecuteAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Func<Guid, DocumentVersionResult>, Func<string, IReadOnlyList<DocumentCommandHistoryEntry>>, DocumentChange> apply,
        CancellationToken cancellationToken = default, Func<ValueTask<CommandResult?>>? authorize = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (documentId != State.Document.Id) throw new InvalidOperationException("Batch document identity mismatch.");
        if (authorize is not null && await authorize() is { } denial) return denial;
        var change = apply(State, _ => throw new InvalidOperationException("Versions are not available in batches."),
            _ => throw new InvalidOperationException("History is not available in batches."));
        if (change.Result.DocumentId != documentId || change.Result.CommandId != commandId || change.Result.ActorId != actor.Id)
            throw new InvalidOperationException("Batch command identity mismatch.");
        if (change.Result.Accepted)
        {
            if (change.State is not { } next || next.Document.Id != documentId || next.Revision != checked(State.Revision + 1) ||
                change.Result.Revision != next.Revision || change.Version is not null || change.AssetContent is not null ||
                change.Event is null or DocumentDeleted or VersionSaved or VersionRestored or HistoryCompensated or BatchApplied)
                throw new InvalidOperationException("Unsupported batch command change.");
            State = next;
        }
        return change.Result;
    }
}
