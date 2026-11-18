using FigVam.Domain.Components;
using System.Collections.Immutable;

namespace FigVam.Domain.Documents;

// IDs and child IDs are occurrence indexes within this result, never document IDs.
public sealed record ExpandedRepeaterNode(int Id, Guid SourceNodeId, Guid? BindingNodeId,
    IReadOnlyList<Guid> InstancePath, string Kind, IReadOnlyDictionary<string, NodePropertyValue> Properties,
    IReadOnlyList<int> ChildIds);

internal static class RepeaterComponentExpansion
{
    internal static (IReadOnlyList<ExpandedRepeaterNode> Nodes, DataDiagnostic? Diagnostic) Expand(
        DocumentStructure document, Guid root)
    {
        var nodes = document.Nodes.ToImmutableDictionary(n => n.Id);
        var instances = document.ComponentInstances.ToDictionary(i => i.NodeId);
        var definitions = document.ComponentDefinitions.ToDictionary(d => d.Id);
        var model = new ComponentModel(document, document.ComponentDefinitions, document.ComponentInstances, document.Tokens, document.Assets.Select(a => a.Id).ToArray());
        var output = new List<ExpandedRepeaterNode>();
        var resolvedInstances = new Dictionary<Guid, ResolvedComponent>();
        var children = new List<List<int>>();
        var pending = new Stack<(Guid Id, ImmutableDictionary<Guid, NodeStructure> Context, Guid[] Path, int Parent, Guid? Binding)>();
        pending.Push((root, nodes, [], -1, null));
        var work = 0;
        DataDiagnostic Limit() => new("DATA_REPEATER_LIMIT", "Component expansion exceeds the shared repeater work budget.");
        while (pending.TryPop(out var frame))
        {
            if (++work > DataBindingEvaluator.MaxRepeaterWork) return ([], Limit());
            var node = frame.Context[frame.Id];
            if (node.Repeater is not null) return ([], new("INVALID_REPEATER", "Nested repeaters, including component content, are not supported."));
            if (instances.TryGetValue(node.Id, out var instance))
            {
                work += frame.Path.Length + 1;
                if (work > DataBindingEvaluator.MaxRepeaterWork) return ([], Limit());
                var definition = definitions[instance.DefinitionId];
                // Bound the resolver's materialization before allocating any definition subtree.
                var seen = new HashSet<Guid>(); var scan = new Stack<Guid>(); scan.Push(definition.RootNodeId);
                foreach (var content in instance.SlotContent.Values.SelectMany(ids => ids)) scan.Push(content);
                while (scan.TryPop(out var id))
                {
                    if (!seen.Add(id)) continue;
                    if (seen.Count + work > DataBindingEvaluator.MaxRepeaterWork) return ([], Limit());
                    foreach (var child in nodes[id].ChildIds) scan.Push(child);
                }
                work += seen.Count;
                if (!resolvedInstances.TryGetValue(node.Id, out var resolved))
                    resolvedInstances[node.Id] = resolved = ComponentOperations.ResolveValidated(model, node.Id);
                var context = frame.Context;
                var definitionIds = ComponentValidator.Descendants(nodes, definition.RootNodeId);
                foreach (var item in resolved.Nodes)
                    context = context.SetItem(item.Id, definitionIds.Contains(item.Id) ? item : frame.Context[item.Id]);
                var supplied = instance.SlotContent.Values.SelectMany(ids => ids).ToHashSet();
                var resolvedRoot = context[definition.RootNodeId];
                context = context.SetItem(definition.RootNodeId, resolvedRoot with
                {
                    ChildIds = [.. resolvedRoot.ChildIds, .. node.ChildIds.Where(id => !supplied.Contains(id))]
                });
                pending.Push((definition.RootNodeId, context, [.. frame.Path, node.Id], frame.Parent, frame.Binding ?? node.Id));
                continue;
            }
            var index = output.Count;
            children.Add([]);
            if (frame.Parent >= 0) children[frame.Parent].Add(index);
            output.Add(new(index, node.Id, frame.Binding, frame.Path, node.Kind, node.Properties, children[index]));
            foreach (var child in node.ChildIds.Reverse()) pending.Push((child, frame.Context, frame.Path, index, null));
        }
        return (output, null);
    }
}
