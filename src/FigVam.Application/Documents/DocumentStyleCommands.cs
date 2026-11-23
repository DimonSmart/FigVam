using System.Collections.Immutable;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(UpsertStyleCommand command, DocumentActor actor, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? detail = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
                Explanation: detail, AffectedIds: code == "ACCEPTED" ? [command.Style.Id] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, ct))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.Style is null ||
            command.Style.Id == Guid.Empty) return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var existing = state.Document.Styles.Any(s => s.Id == command.Style.Id);
            IReadOnlyList<DesignStyle> styles = existing
                ? state.Document.Styles.Select(s => s.Id == command.Style.Id ? command.Style : s).ToArray()
                : [.. state.Document.Styles, command.Style];
            var changed = state.Document with { Styles = styles };
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } error)
                return new(Result("INVALID_STYLE", detail: $"{error.ObjectId} · {error.Property}: {error.Message}"), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new StyleUpserted(command.Style));
        }, ct, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, ct) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(DeleteStyleCommand command, DocumentActor actor, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? detail = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
                Explanation: detail, AffectedIds: code == "ACCEPTED" ? [command.StyleId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, ct))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.StyleId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            if (!state.Document.Styles.Any(s => s.Id == command.StyleId))
                return new(Result("STYLE_NOT_FOUND"), null);
            var changed = state.Document with { Styles = state.Document.Styles.Where(s => s.Id != command.StyleId).ToArray() };
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } error)
                return new(Result("STYLE_IN_USE", detail: $"{error.ObjectId} · {error.Property}: {error.Message}"), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new StyleDeleted(command.StyleId));
        }, ct, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, ct) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(RemoveNodePropertiesCommand command, DocumentActor actor, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? detail = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
                NodeId: command.NodeId, Explanation: detail);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, ct))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        if (command.Properties is not { Count: > 0 and <= 64 } || command.Properties.Any(string.IsNullOrWhiteSpace) ||
            command.Properties.Count != command.Properties.Distinct(StringComparer.Ordinal).Count())
            return Result("INVALID_PROPERTY_VALUE");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == command.NodeId);
            if (node is null) return new(Result("NODE_NOT_FOUND"), null);
            if (command.Properties.Any(p => !node.Properties.ContainsKey(p)))
                return new(Result("PROPERTY_OVERRIDE_NOT_FOUND"), null);
            var values = node.Properties.RemoveRange(command.Properties);
            var changed = state.Document with { Nodes = state.Document.Nodes.Select(n => n.Id == node.Id
                ? n with { Properties = values } : n).ToArray() };
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } error)
                return new(Result("INVALID_PROPERTY_VALUE", detail: error.Message), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new NodePropertiesRemoved(node.Id, command.Properties));
        }, ct, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, ct) ? null : Result("FORBIDDEN"));
    }
}

public sealed record NodePropertiesRemoved(Guid NodeId, IReadOnlyList<string> Properties) : DocumentEvent;
