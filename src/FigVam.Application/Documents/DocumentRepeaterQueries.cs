using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record RepeaterEvaluationResponse(Guid DocumentId, long Revision, Guid NodeId, Guid? EmptyViewNodeId,
    IReadOnlyList<IReadOnlyList<RepeaterPropertyValue>> Items, int Offset, int Limit, int Total, DataDiagnostic? Diagnostic)
{
    public IReadOnlyList<ExpandedRepeaterNode> TemplateNodes { get; init; } = [];
    public IReadOnlyList<ExpandedRepeaterNode> EmptyViewNodes { get; init; } = [];
}
public sealed record RepeaterEvaluationResult(string Code, RepeaterEvaluationResponse? Response = null);
public interface IDocumentRepeaterQueries
{
    Task<RepeaterEvaluationResult> EvaluateAsync(Guid documentId, Guid nodeId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken cancellationToken = default);
}
public sealed class DocumentRepeaterQueries(IDocumentAuthorization authorization, IDocumentStateReader reader, INodeProfile profile) : IDocumentRepeaterQueries
{
    public async Task<RepeaterEvaluationResult> EvaluateAsync(Guid documentId, Guid nodeId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || nodeId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, cancellationToken);
        if (read.State is not { } state) return new(read.Code);
        var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node is null) return new("NODE_NOT_FOUND");
        if (node.Repeater is null) return new("REPEATER_NOT_FOUND");
        if (PortableUiProfileResolver.Resolve(state.Document.Profile, profile, out var selected) is { } invalid)
            return new(invalid.Code);
        var result = NodeRepeaterEvaluator.Evaluate(state.Document, node, node.Repeater, selected!);
        return new("OK", new(documentId, state.Revision, nodeId, result.EmptyViewNodeId,
            result.Items?.Skip(offset).Take(limit).ToArray() ?? [], offset, limit, result.Items?.Count ?? 0, result.Diagnostic)
        { TemplateNodes = result.TemplateNodes, EmptyViewNodes = result.EmptyViewNodes });
    }
}
