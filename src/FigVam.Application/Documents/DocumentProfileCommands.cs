using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(UpgradePortableUiProfileCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(
            command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            Explanation: explanation);

        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.ExpectedRevision < 0)
            return Result("INVALID_REVISION");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            if (state.Document.Profile != PortableUiProfileReference.Version1)
                return new(Result("PROFILE_UPGRADE_NOT_APPLICABLE", explanation: "This upgrade requires Portable UI Profile version 1."), null);
            if (PortableUiProfileResolver.Validate(PortableUiProfileReference.Version2, profile) is { } unavailable)
                return new(Result(unavailable.Code, explanation: unavailable.Message), null);
            var document = state.Document with { Profile = PortableUiProfileReference.Version2 };
            if (DocumentStructureValidator.Validate(document, profile).FirstOrDefault() is { } invalid)
                return new(Result("INVALID_PROFILE_UPGRADE", explanation: invalid.Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new PortableUiProfileUpgraded(document.Profile));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}
