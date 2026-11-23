using FigVam.Domain.Documents;
using FigVam.Domain.Layout;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

internal static class ScreenLayoutPreview
{
    public static DocumentStructure Project(DocumentStructure document, ScreenStructure screen, ScreenVariant? variant,
        Guid? datasetId, INodeProfile profile, Dictionary<Guid, Dictionary<string, NodePropertyValue>> overrides,
        List<LayoutDiagnostic> diagnostics, TokenTheme theme = TokenTheme.Light)
    {
        var nodes = document.Nodes.ToLookup(node => node.Id);
        var visited = new HashSet<Guid>();
        var pending = new Stack<Guid>(screen.ChildIds);
        var styles = new DesignStyleResolver(document, profile);
        var variants = (variant?.Overrides ?? []).GroupBy(change => change.NodeId)
            .ToDictionary(group => group.Key, group => (IReadOnlyDictionary<string, NodePropertyValue>)group.ToDictionary(
                change => change.Property, change => change.Value, StringComparer.Ordinal));

        while (pending.TryPop(out var id))
        {
            if (!visited.Add(id) || nodes[id].FirstOrDefault() is not { } node)
                continue;
            foreach (var child in node.ChildIds)
                pending.Push(child);
            try
            {
                var variantFields = variants.GetValueOrDefault(id);
                var effective = styles.EffectiveNode(node, theme, variantFields);
                // A projected value is transient: the saved node retains its style/token reference.
                // Explicit variant overrides are reflected in the effective values after style inheritance.
                if (node.Properties.ContainsKey("textStyle") || node.Properties.ContainsKey("borderStyle") ||
                    node.Properties.ContainsKey("typography") || variantFields is not null)
                    foreach (var (property, value) in effective)
                        Set(id, property, value);
            }
            catch (DesignStyleException error)
            {
                diagnostics.Add(new(error.Code, id, error.Field, error.Message));
            }
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
