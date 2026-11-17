using System.Text.Json;
using FigVam.Domain.Components;

namespace FigVam.Domain.Documents;

public sealed record RepeaterItemBinding(Guid NodeId, string Property, DataBinding Binding);
public sealed record NodeRepeater(Guid DatasetId, DataBinding Items, Guid TemplateNodeId, Guid EmptyViewNodeId,
    IReadOnlyList<RepeaterItemBinding> Bindings);
public sealed record RepeaterPropertyValue(Guid NodeId, string Property, NodePropertyValue Value);
public sealed record NodeRepeaterResult(Guid? EmptyViewNodeId, IReadOnlyList<IReadOnlyList<RepeaterPropertyValue>>? Items, DataDiagnostic? Diagnostic)
{
    public IReadOnlyList<ExpandedRepeaterNode> TemplateNodes { get; init; } = [];
    public IReadOnlyList<ExpandedRepeaterNode> EmptyViewNodes { get; init; } = [];
}

public static class NodeRepeaterEvaluator
{
    public static DataDiagnostic? Validate(DocumentStructure document, NodeStructure owner, NodeRepeater config, INodeProfile profile)
    {
        DataDiagnostic Invalid(string message) => new("INVALID_REPEATER", message);
        if (!profile.IsKnownKind(owner.Kind)) return new("UNSUPPORTED_NODE_KIND", "The current profile does not support the repeater container kind.");
        if (!profile.CanContainChildren(owner.Kind)) return Invalid("A repeater requires a container.");
        if (!document.Datasets.Any(d => d.Id == config.DatasetId)) return new("DATASET_NOT_FOUND", "The repeater dataset does not exist.");
        if (config.TemplateNodeId == config.EmptyViewNodeId || owner.ChildIds.Count != 2 ||
            !owner.ChildIds.Contains(config.TemplateNodeId) || !owner.ChildIds.Contains(config.EmptyViewNodeId))
            return Invalid("Template and empty view must be distinct, exclusively owned direct children of the repeater.");
        if (config.Items is null || config.Items.Operation != DataOperation.Value || config.Items.ExpectedType != DataExpectedType.Array ||
            DataBindingEvaluator.Validate(config.Items) is not null || config.Bindings is null || config.Bindings.Count > DataBindingEvaluator.MaxRepeaterBindings)
            return Invalid("A bounded array path and bounded relative bindings are required.");
        var nodes = document.Nodes.GroupBy(n => n.Id).ToDictionary(g => g.Key, g => g.First());
        HashSet<Guid>? Subtree(Guid root)
        {
            var visited = new HashSet<Guid>(); var pending = new Stack<Guid>(); pending.Push(root);
            while (pending.TryPop(out var id))
            {
                if (!visited.Add(id) || !nodes.TryGetValue(id, out var node)) return null;
                foreach (var child in node.ChildIds) pending.Push(child);
            }
            return visited;
        }
        var template = Subtree(config.TemplateNodeId); var empty = Subtree(config.EmptyViewNodeId);
        if (template is null || empty is null || template.Overlaps(empty) || template.Contains(owner.Id) || empty.Contains(owner.Id))
            return Invalid("Repeater subtrees must exist without cycles or shared ownership.");
        var owned = template.Concat(empty).ToHashSet();
        var parents = document.Nodes.SelectMany(n => n.ChildIds).Concat(document.Screens.SelectMany(s => s.ChildIds))
            .GroupBy(id => id).ToDictionary(g => g.Key, g => g.Count());
        foreach (var id in owned)
        {
            if (parents.GetValueOrDefault(id) != 1) return Invalid("Repeater subtrees must have exactly one structural parent.");
            if (nodes[id].Repeater is not null) return Invalid("Nested repeaters exceed the supported structural evaluation limits.");
        }
        if (document.ComponentDefinitions?.Any(d => d is not null && owned.Contains(d.RootNodeId)) == true)
            return Invalid("Component definitions must live outside repeater subtrees; insert instances for reuse.");
        var targets = new HashSet<(Guid, string)>();
        foreach (var binding in config.Bindings)
        {
            if (binding is null || !template.Contains(binding.NodeId) || string.IsNullOrWhiteSpace(binding.Property) || binding.Property.Length > 256 ||
                !targets.Add((binding.NodeId, binding.Property)) || nodes[binding.NodeId].DataBindings is null || nodes[binding.NodeId].DataBindings.ContainsKey(binding.Property))
                return Invalid("Relative bindings require distinct properties in the template without another data binding.");
            if (NodeDataBindingEvaluator.Validate(document, nodes[binding.NodeId], binding.Property, new(config.DatasetId, binding.Binding), profile) is { } error)
                return error;
        }
        if (document.ComponentDefinitions is null || document.ComponentInstances is null ||
            document.ComponentDefinitions.Any(d => d is null || d.Parameters is null || d.Slots is null || d.Variants is null || d.Bindings is null) ||
            document.ComponentInstances.Any(i => i is null || i.ParameterOverrides is null || i.SlotContent is null || i.SlotContent.Values.Any(v => v is null)))
            return new("INVALID_REPEATER", "Component contracts are required.");
        // Avoid re-entering this validator through component structure validation.
        if (ComponentValidator.ValidateWithoutRepeaters(new(document, document.ComponentDefinitions, document.ComponentInstances, document.Tokens, []), profile).FirstOrDefault() is { } componentError)
            return new(componentError.Code, componentError.Message);
        foreach (var root in new[] { config.TemplateNodeId, config.EmptyViewNodeId })
        {
            var expanded = RepeaterComponentExpansion.Expand(document, root);
            if (expanded.Diagnostic is { } expansionError) return expansionError;
            if (root != config.TemplateNodeId) continue;
            foreach (var binding in config.Bindings)
            {
                var target = BindingTarget(expanded.Nodes, binding.NodeId);
                if (target is null) return Invalid("A relative binding must address a visible expanded template node.");
                if (NodeDataBindingEvaluator.Validate(document, nodes[binding.NodeId] with { Kind = target.Kind }, binding.Property,
                    new(config.DatasetId, binding.Binding), profile) is { } error) return error;
            }
        }
        return null;
    }

    public static NodeRepeaterResult Evaluate(DocumentStructure document, NodeStructure owner, NodeRepeater config, INodeProfile profile)
    {
        NodeRepeaterResult Error(DataDiagnostic error) => new(null, null, error);
        if (Validate(document, owner, config, profile) is { } invalid) return Error(invalid);
        using var json = JsonDocument.Parse(document.Datasets.Single(d => d.Id == config.DatasetId).FixtureJson);
        var array = DataBindingEvaluator.Evaluate(json.RootElement, config.Items);
        if (array.Diagnostic is { } error) return Error(DataError(error));
        var count = array.Value!.Value.GetArrayLength();
        var template = RepeaterComponentExpansion.Expand(document, config.TemplateNodeId).Nodes;
        var empty = RepeaterComponentExpansion.Expand(document, config.EmptyViewNodeId).Nodes;
        var work = (long)config.Items.Path.Count + 1 + (count == 0 ? empty.Count : (long)count *
            (template.Count + config.Bindings.Sum(b => (long)b.Binding.Path.Count + 1)));
        if (count > DataBindingEvaluator.MaxRepeaterItems || work > DataBindingEvaluator.MaxRepeaterWork)
            return Error(new("DATA_REPEATER_LIMIT", "Expanded template nodes and all relative paths exceed the shared work budget."));
        var output = new List<IReadOnlyList<RepeaterPropertyValue>>(count);
        foreach (var item in array.Value.Value.EnumerateArray())
        {
            var values = new List<RepeaterPropertyValue>();
            foreach (var binding in config.Bindings)
            {
                var result = DataBindingEvaluator.Evaluate(item, binding.Binding);
                if (result.Diagnostic is { } diagnostic) return Error(DataError(diagnostic));
                var scalar = NodeDataBindingEvaluator.ToPropertyValue(result.Value!.Value);
                if (NodePropertyValidator.Validate(profile, BindingTarget(template, binding.NodeId)!.Kind, binding.Property, scalar) is { } propertyError)
                    return Error(new(propertyError.Code, propertyError.Reason));
                values.Add(new(binding.NodeId, binding.Property, scalar!));
            }
            output.Add(values);
        }
        return new(count == 0 ? config.EmptyViewNodeId : null, output, null)
        {
            TemplateNodes = count == 0 ? [] : template,
            EmptyViewNodes = count == 0 ? empty : []
        };
    }

    private static DataDiagnostic DataError(DataDiagnostic error) => new("DATA_" + error.Code.Replace('-', '_').ToUpperInvariant(), error.Message);

    private static ExpandedRepeaterNode? BindingTarget(IReadOnlyList<ExpandedRepeaterNode> nodes, Guid id)
        => nodes.FirstOrDefault(n => n.BindingNodeId == id || n.InstancePath.Count == 0 && n.SourceNodeId == id)
            ?? nodes.FirstOrDefault(n => n.SourceNodeId == id);
}
