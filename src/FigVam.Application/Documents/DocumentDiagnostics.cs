using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record StructureDiagnostic(
    [property: System.ComponentModel.Description("Structure validator code: empty-id, duplicate-id, missing-reference, wrong-reference-type, INVALID_NODE_METADATA, unknown-node-kind, children-not-allowed, invalid-properties, UNSUPPORTED_PROPERTY, INVALID_PROPERTY_TYPE, INVALID_PROPERTY_VALUE, node-ownership, or cycle.")] string Code,
    [property: System.ComponentModel.Description("ID-based document element path; property names use JSON Pointer escaping.")] string Path,
    string Message, Guid? ReferenceId, string? Property);
public sealed record StructureDiagnosticsResponse(Guid DocumentId, long Revision, Guid? ScreenId,
    IReadOnlyList<StructureDiagnostic> Items, int Offset, int Limit, int Total);
public sealed record StructureDiagnosticsResult(string Code, StructureDiagnosticsResponse? Response = null);

public interface IDocumentDiagnostics
{
    Task<StructureDiagnosticsResult> ReadAsync(Guid documentId, Guid? screenId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken cancellationToken = default);
}

public sealed class DocumentDiagnostics(IDocumentAuthorization authorization, IDocumentStateReader reader, INodeProfile profile) : IDocumentDiagnostics
{
    public async Task<StructureDiagnosticsResult> ReadAsync(Guid documentId, Guid? screenId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || screenId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, cancellationToken);
        if (read.State is not { } state) return new(read.Code);
        var document = state.Document;
        HashSet<Guid>? scope = null;
        if (screenId is { } id)
        {
            var screen = document.Screens.FirstOrDefault(s => s.Id == id);
            if (screen is null) return new("SCREEN_NOT_FOUND");
            scope = [id, .. screen.Variants.Select(v => v.Id)];
            var nodes = document.Nodes.GroupBy(n => n.Id).ToDictionary(g => g.Key, g => g.ToArray());
            var pending = new Stack<Guid>(screen.ChildIds);
            while (pending.TryPop(out var child))
                if (scope.Add(child) && nodes.TryGetValue(child, out var matches))
                    foreach (var node in matches) foreach (var next in node.ChildIds) pending.Push(next);
        }
        string Path(StructureError error)
        {
            var variantScreen = document.Screens.FirstOrDefault(s => s.Variants.Any(v => v.Id == error.ObjectId));
            var category = variantScreen is not null ? "/screens/" + variantScreen.Id + "/variants/" + error.ObjectId : error.ObjectId == document.Id ? "" : document.Pages.Any(p => p.Id == error.ObjectId) ? "/pages/" + error.ObjectId :
                document.Screens.Any(s => s.Id == error.ObjectId) ? "/screens/" + error.ObjectId : "/nodes/" + error.ObjectId;
            var property = error.Property is null ? "" : "/properties/" + error.Property.Replace("~", "~0").Replace("/", "~1");
            return "/documents/" + document.Id + category + property;
        }
        var errors = DocumentStructureValidator.Validate(document, profile)
            .Concat(document.Nodes.Where(n => n.DataBindings is not null).SelectMany(node => node.DataBindings.Select(pair =>
                (pair.Key, Binding: pair.Value, Result: NodeDataBindingEvaluator.Evaluate(document, node, pair.Key, pair.Value, profile)))
                .Where(item => item.Result.Diagnostic is not null)
                .Select(item => new StructureError(item.Result.Diagnostic!.Code, node.Id, item.Binding.DatasetId, item.Result.Diagnostic.Message, item.Key))))
            .Concat(document.Nodes.Where(n => n.Repeater is not null).Select(node =>
                (Node: node, Result: NodeRepeaterEvaluator.Evaluate(document, node, node.Repeater!, profile)))
                .Where(item => item.Result.Diagnostic is not null)
                .Select(item => new StructureError(item.Result.Diagnostic!.Code, item.Node.Id, item.Node.Repeater!.DatasetId, item.Result.Diagnostic.Message, "repeater")))
            .Distinct()
            .Where(e => scope is null || scope.Contains(e.ObjectId))
            .Select(e => new StructureDiagnostic(e.Code, Path(e), e.Message, e.ReferenceId, e.Property)).ToArray();
        return new("OK", new(documentId, state.Revision, screenId, errors.Skip(offset).Take(limit).ToArray(), offset, limit, errors.Length));
    }
}

