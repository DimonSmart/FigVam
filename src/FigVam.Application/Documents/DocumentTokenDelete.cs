using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(DeleteTokenCommand command, DocumentActor actor, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? detail = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
                Explanation: detail, AffectedIds: code == "ACCEPTED" ? [command.TokenId] : null) { Source = actor.Source };
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, ct))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.TokenId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            if (!state.Document.Tokens.Any(t => t.Id == command.TokenId))
                return new(Result("TOKEN_NOT_FOUND"), null);
            var uses = new DesignResourceDependencies(state.Document).Usages("token", command.TokenId);
            if (uses.Count != 0)
            {
                var first = uses[0];
                return new(Result("TOKEN_IN_USE", state.Revision, detail:
                    $"Token has {uses.Count} dependent usages. First: {first.Label} ({first.Kind}.{first.Property})."), null);
            }
            var changed = state.Document with
            {
                Tokens = state.Document.Tokens.Where(t => t.Id != command.TokenId).ToArray()
            };
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } error)
                return new(Result("TOKEN_IN_USE", state.Revision, detail: $"{error.ObjectId} · {error.Property}: {error.Message}"), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new TokenDeleted(command.TokenId));
        }, ct, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, ct) ? null : Result("FORBIDDEN"));
    }
}
