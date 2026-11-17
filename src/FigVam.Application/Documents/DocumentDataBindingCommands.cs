using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(BindNodeDataCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeNodeDataAsync(command.DocumentId, command.CommandId, command.NodeId, command.Property, command.Binding, true, actor, cancellationToken);
    public Task<CommandResult> HandleAsync(UnbindNodeDataCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeNodeDataAsync(command.DocumentId, command.CommandId, command.NodeId, command.Property, null, false, actor, cancellationToken);

    private async Task<CommandResult> ChangeNodeDataAsync(Guid documentId, Guid commandId, Guid nodeId, string property,
        NodeDataBinding? binding, bool bind, DocumentActor actor, CancellationToken ct)
    {
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(documentId, commandId, code, revision,
            actor.Id, null, DateTimeOffset.UtcNow, NodeId: nodeId, Property: property, Explanation: explanation);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty || nodeId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId);
            if (node is null) return new(Result("NODE_NOT_FOUND", explanation: "The target node does not exist."), null);
            if (string.IsNullOrWhiteSpace(property) || property.Length > 256) return new(Result("INVALID_DATA_BINDING", explanation: "A bounded target property is required."), null);
            if (bind)
            {
                if (NodeDataBindingEvaluator.Validate(state.Document, node, property, binding, profile) is { } error)
                    return new(Result(error.Code, explanation: error.Message), null);
                if (NodeDataBindingEvaluator.Evaluate(state.Document, node, property, binding!, profile).Diagnostic is { } invalid)
                    return new(Result(invalid.Code, explanation: invalid.Message), null);
            }
            else if (!node.DataBindings.ContainsKey(property)) return new(Result("DATA_BINDING_NOT_FOUND", explanation: "This node property has no data binding."), null);
            if (bind && state.Document.Nodes.Any(n => n.Repeater?.Bindings.Any(b => b.NodeId == nodeId && b.Property == property) == true))
                return new(Result("INVALID_REPEATER", explanation: "The property is already bound relative to a repeater item."), null);
            var next = new DocumentState(DocumentStructureEditor.SetNodeDataBinding(state.Document, nodeId, property, binding), checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new NodeDataBindingSet(nodeId, property, binding));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }

}
