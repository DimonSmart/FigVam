namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(DeleteDocumentCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            AffectedIds: code == "ACCEPTED" ? [command.DocumentId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanDeleteAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        if (journal is IDocumentDeletionJournal catalog)
            return await catalog.DeleteAsync(command, actor, cancellationToken);
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var next = state with { Revision = checked(state.Revision + 1) };
            return new(Result("ACCEPTED", next.Revision), next, new DocumentDeleted());
        }, cancellationToken, authorize: async () =>
            await authorization.CanDeleteAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}

public interface IDocumentDeletionJournal
{
    Task<CommandResult> DeleteAsync(DeleteDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
}
