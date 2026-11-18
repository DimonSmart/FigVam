using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(DeletePageCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, code == "ACCEPTED" ? command.PageId : null,
            DateTimeOffset.UtcNow, Explanation: explanation);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.PageId == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (command.ExpectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            if (!state.Document.Pages.Any(p => p.Id == command.PageId)) return new(Result("PAGE_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var document = DocumentStructureEditor.DeletePage(state.Document, command.PageId);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("PAGE_IN_USE", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision) with { AffectedIds = ChangedIds(DocumentPatch.Between(state.Document, document)) },
                next, new PageDeleted(command.PageId));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}
