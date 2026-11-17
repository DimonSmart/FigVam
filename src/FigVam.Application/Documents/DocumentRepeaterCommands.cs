using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(SetNodeRepeaterCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId, command.CommandId,
            code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId, Explanation: explanation, Property: "repeater");
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.ExpectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == command.NodeId);
            if (node is null) return new(Result("NODE_NOT_FOUND"), null);
            if (command.ExpectedRevision != state.Revision) return new(Result("REVISION_CONFLICT"), null);
            var changed = DocumentStructureEditor.SetNodeRepeater(state.Document, node.Id, command.Repeater);
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } invalid)
                return new(Result(invalid.Code, explanation: invalid.Message), null);
            if (command.Repeater is { } config && NodeRepeaterEvaluator.Evaluate(changed, changed.Nodes.Single(n => n.Id == node.Id), config, profile).Diagnostic is { } error)
                return new(Result(error.Code, explanation: error.Message), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new NodeRepeaterSet(node.Id, command.Repeater));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}
