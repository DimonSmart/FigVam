using FigVam.Domain.Documents;
using FigVam.Domain.Layout;

namespace FigVam.Application.Documents;

internal static class ScreenLayoutPreview
{
    public static DocumentStructure Project(DocumentStructure document, ScreenStructure screen, ScreenVariant? variant,
        Guid? datasetId, INodeProfile profile, Dictionary<Guid, Dictionary<string, NodePropertyValue>> overrides,
        List<LayoutDiagnostic> diagnostics)
    {
        var nodes = document.Nodes.ToLookup(node => node.Id);
        var visited = new HashSet<Guid>();
        var pending = new Stack<Guid>(screen.ChildIds);
        foreach (var change in variant?.Overrides ?? [])
            Set(change.NodeId, change.Property, change.Value);

        while (pending.TryPop(out var id))
        {
            if (!visited.Add(id) || nodes[id].FirstOrDefault() is not { } node)
                continue;
            foreach (var child in node.ChildIds)
                pending.Push(child);
            foreach (var (property, binding) in node.DataBindings)
            {
                var evaluated = NodeDataBindingEvaluator.Evaluate(document, node, property,
                    datasetId is { } selected ? binding with { DatasetId = selected } : binding, profile);
                if (evaluated.Value is { } value)
                    Set(id, property, value);
                if (evaluated.Diagnostic is { } error)
                    diagnostics.Add(new(error.Code, id, property, error.Message));
            }
        }

        return document with
        {
            Nodes = document.Nodes.Select(node => overrides.TryGetValue(node.Id, out var values)
                ? node with { Properties = node.Properties.SetItems(values) }
                : node).ToArray()
        };

        void Set(Guid id, string property, NodePropertyValue value)
        {
            if (!overrides.TryGetValue(id, out var properties))
                overrides.Add(id, properties = new(StringComparer.Ordinal));
            properties[property] = value;
        }
    }
}
