using System.Collections.Immutable;
using FigVam.Domain.Tokens;
using FigVam.Domain.Components;

namespace FigVam.Domain.Documents;

// The profile registry owns node kinds and their structural capabilities.
public interface INodeProfile
{
    PortableUiProfileReference Identity { get; }
    INodeProfile? GetInstalledVersion(int version) => version == Identity.Version ? this : null;
    IReadOnlyList<NodeKindDefinition> Kinds => [];
    IReadOnlyList<string> PreviewActions => [];
    bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event);
    bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action);
    bool SupportsDemoValue(string kind);
    NodePropertyDefinition? GetProperty(string kind, string property);
    bool IsKnownKind(string kind);
    bool CanContainChildren(string kind);
}

public sealed record DocumentStructure(Guid Id, IReadOnlyList<PageStructure> Pages,
    IReadOnlyList<ScreenStructure> Screens, IReadOnlyList<NodeStructure> Nodes)
{
    [System.Text.Json.Serialization.JsonRequired]
    public string Name { get; init; } = "Document";
    [System.Text.Json.Serialization.JsonRequired]
    public PortableUiProfileReference Profile { get; init; } = PortableUiProfileReference.Version1;
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<DocumentAsset> Assets { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<FigVam.Domain.Preview.PreviewScenario> Scenarios { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<DocumentDataset> Datasets { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<DesignToken> Tokens { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<ComponentDefinition> ComponentDefinitions { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<ComponentInstance> ComponentInstances { get; init; } = [];
}

public sealed record PageStructure(Guid Id, IReadOnlyList<Guid> ScreenIds)
{
    public string Name { get; init; } = "Page";
}
public sealed record ScreenStructure(Guid Id, IReadOnlyList<Guid> ChildIds,
    [property: System.Text.Json.Serialization.JsonRequired] ScreenDimensions Dimensions)
{
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<ScreenVariant> Variants { get; init; } = [];
}
public sealed record NodeStructure(Guid Id, string Kind, IReadOnlyList<Guid> ChildIds)
{
    [System.Text.Json.Serialization.JsonRequired]
    public NodeRepeater? Repeater { get; init; }

    [System.Text.Json.Serialization.JsonRequired]
    public string Name { get; init; } = "";
    [System.Text.Json.Serialization.JsonRequired]
    public string? SemanticKey { get; init; }

    private readonly ImmutableSortedDictionary<string, NodeDataBinding> dataBindings
        = ImmutableSortedDictionary<string, NodeDataBinding>.Empty.WithComparers(StringComparer.Ordinal);
    [System.Text.Json.Serialization.JsonRequired]
    public ImmutableSortedDictionary<string, NodeDataBinding> DataBindings
    {
        get => dataBindings;
        init => dataBindings = value?.WithComparers(StringComparer.Ordinal)!;
    }

    private readonly ImmutableSortedDictionary<string, NodePropertyValue> properties
        = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.WithComparers(StringComparer.Ordinal);

    [System.Text.Json.Serialization.JsonRequired]
    public ImmutableSortedDictionary<string, NodePropertyValue> Properties
    {
        get => properties;
        init => properties = value?.WithComparers(StringComparer.Ordinal)!;
    }
}

public static class DocumentStructureEditor
{
    public static DocumentStructure SetNodeRepeater(DocumentStructure document, Guid nodeId, NodeRepeater? repeater)
        => document with { Nodes = document.Nodes.Select(n => n.Id == nodeId ? n with { Repeater = repeater } : n).ToArray() };

    public static DocumentStructure SetNodeDataBinding(DocumentStructure document, Guid nodeId, string property, NodeDataBinding? binding)
        => document with { Nodes = document.Nodes.Select(n => n.Id == nodeId ? n with { DataBindings = binding is null
            ? n.DataBindings.Remove(property) : n.DataBindings.SetItem(property, binding) } : n).ToArray() };

    public static DocumentStructure AddComponentSlot(DocumentStructure document, Guid definitionId, ComponentSlot slot)
    {
        if (!document.ComponentDefinitions.Any(d => d.Id == definitionId)) throw new InvalidOperationException("Component definition does not exist.");
        return document with { ComponentDefinitions = document.ComponentDefinitions.Select(d => d.Id == definitionId
            ? d with { Slots = [.. d.Slots, slot] } : d).ToArray() };
    }

    public static DocumentStructure SetComponentSlotContent(DocumentStructure document, Guid nodeId, Guid slotId, IReadOnlyList<Guid> contentNodeIds)
    {
        if (!document.ComponentInstances.Any(i => i.NodeId == nodeId)) throw new InvalidOperationException("Node is not a component instance.");
        return document with { ComponentInstances = document.ComponentInstances.Select(i =>
        {
            if (i.NodeId != nodeId) return i;
            var slots = i.SlotContent.ToDictionary(p => p.Key, p => p.Value);
            if (contentNodeIds.Count == 0) slots.Remove(slotId); else slots[slotId] = contentNodeIds.ToArray();
            return i with { SlotContent = slots };
        }).ToArray() };
    }

    public static DocumentStructure AddComponentVariant(DocumentStructure document, Guid definitionId, ComponentVariant variant)
    {
        if (!document.ComponentDefinitions.Any(d => d.Id == definitionId)) throw new InvalidOperationException("Component definition does not exist.");
        return document with { ComponentDefinitions = document.ComponentDefinitions.Select(d => d.Id == definitionId
            ? d with { Variants = [.. d.Variants, variant with { ParameterChanges = variant.ParameterChanges.ToDictionary(p => p.Key, p => p.Value) }] } : d).ToArray() };
    }

    public static DocumentStructure SetComponentInstanceVariant(DocumentStructure document, Guid nodeId, Guid? variantId)
    {
        if (!document.ComponentInstances.Any(i => i.NodeId == nodeId)) throw new InvalidOperationException("Node is not a component instance.");
        return document with { ComponentInstances = document.ComponentInstances.Select(i => i.NodeId == nodeId ? i with { VariantId = variantId } : i).ToArray() };
    }

    public static DocumentStructure SetComponentParameterOverride(DocumentStructure document, Guid nodeId, Guid parameterId, ComponentValue? value)
    {
        if (!document.ComponentInstances.Any(i => i.NodeId == nodeId)) throw new InvalidOperationException("Node is not a component instance.");
        return document with { ComponentInstances = document.ComponentInstances.Select(instance =>
        {
            if (instance.NodeId != nodeId) return instance;
            var overrides = instance.ParameterOverrides.ToDictionary(p => p.Key, p => p.Value);
            if (value is null) overrides.Remove(parameterId); else overrides[parameterId] = value;
            return instance with { ParameterOverrides = overrides };
        }).ToArray() };
    }

    public static DocumentStructure SetComponentVariantParameterChange(DocumentStructure document, Guid definitionId, Guid variantId, Guid parameterId, ComponentValue? value)
    {
        var definition = document.ComponentDefinitions.FirstOrDefault(d => d.Id == definitionId)
            ?? throw new InvalidOperationException("Component definition does not exist.");
        if (!definition.Parameters.Any(p => p.Id == parameterId) || !definition.Variants.Any(v => v.Id == variantId))
            throw new InvalidOperationException("Variant and parameter must belong to the component definition.");
        return document with { ComponentDefinitions = document.ComponentDefinitions.Select(d => d.Id == definitionId
            ? d with { Variants = d.Variants.Select(v =>
            {
                if (v.Id != variantId) return v;
                var changes = v.ParameterChanges.ToDictionary(p => p.Key, p => p.Value);
                if (value is null) changes.Remove(parameterId); else changes[parameterId] = value;
                return v with { ParameterChanges = changes };
            }).ToArray() } : d).ToArray() };
    }

    public static DocumentStructure SetComponentParameterDefault(DocumentStructure document, Guid definitionId, Guid parameterId, ComponentValue value)
    {
        var definition = document.ComponentDefinitions.FirstOrDefault(d => d.Id == definitionId)
            ?? throw new InvalidOperationException("Component definition does not exist.");
        if (!definition.Parameters.Any(p => p.Id == parameterId)) throw new InvalidOperationException("Component parameter does not exist.");
        return document with { ComponentDefinitions = document.ComponentDefinitions.Select(d => d.Id == definitionId
            ? d with { Parameters = d.Parameters.Select(p => p.Id == parameterId ? p with { DefaultValue = value } : p).ToArray() } : d).ToArray() };
    }

    public static DocumentStructure AddComponentParameter(DocumentStructure document, Guid definitionId,
        ComponentParameter parameter, ComponentParameterBinding binding)
    {
        if (!document.ComponentDefinitions.Any(d => d.Id == definitionId)) throw new InvalidOperationException("Component definition does not exist.");
        return document with { ComponentDefinitions = document.ComponentDefinitions.Select(d => d.Id == definitionId
            ? d with { Parameters = [.. d.Parameters, parameter], Bindings = [.. d.Bindings, binding] } : d).ToArray() };
    }

    public static DocumentStructure SetNodeProperty(DocumentStructure document, Guid nodeId, string property, NodePropertyValue value)
        => SetNodeProperties(document, nodeId, [new(property, value)]);

    public static DocumentStructure SetNodeProperties(DocumentStructure document, Guid nodeId,
        IEnumerable<KeyValuePair<string, NodePropertyValue>> properties)
    {
        if (!document.Nodes.Any(n => n.Id == nodeId)) throw new InvalidOperationException("Node does not exist.");
        return document with { Nodes = document.Nodes.Select(n => n.Id == nodeId
            ? n with { Properties = n.Properties.SetItems(properties) } : n).ToArray() };
    }

    public static DocumentStructure AddScreen(DocumentStructure document, Guid pageId, Guid screenId, ScreenDimensions dimensions)
        => document with
        {
            Pages = document.Pages.Select(p => p.Id == pageId
                ? p with { ScreenIds = p.ScreenIds.Append(screenId).ToArray() } : p).ToArray(),
            Screens = document.Screens.Append(new ScreenStructure(screenId, [], dimensions)).ToArray()
        };

    public static DocumentStructure AddNode(DocumentStructure document, Guid parentId, Guid nodeId, string kind,
        ImmutableSortedDictionary<string, NodePropertyValue>? properties = null)
        => document with
        {
            Screens = document.Screens.Select(s => s.Id == parentId
                ? s with { ChildIds = s.ChildIds.Append(nodeId).ToArray() } : s).ToArray(),
            Nodes = document.Nodes.Select(n => n.Id == parentId
                ? n with { ChildIds = n.ChildIds.Append(nodeId).ToArray() } : n)
                .Append(new NodeStructure(nodeId, kind, [])
                {
                    Properties = properties ?? ImmutableSortedDictionary<string, NodePropertyValue>.Empty
                }).ToArray()
        };

    public static DocumentStructure InsertComponentInstance(DocumentStructure document, Guid parentId, int position,
        NodeStructure anchor, ComponentInstance instance)
    {
        IReadOnlyList<Guid> Insert(IReadOnlyList<Guid> children)
        {
            var result = children.ToList();
            result.Insert(position, anchor.Id);
            return result.ToArray();
        }
        return document with
        {
            Screens = document.Screens.Select(s => s.Id == parentId ? s with { ChildIds = Insert(s.ChildIds) } : s).ToArray(),
            Nodes = document.Nodes.Select(n => n.Id == parentId ? n with { ChildIds = Insert(n.ChildIds) } : n).Append(anchor).ToArray(),
            ComponentInstances = [.. document.ComponentInstances, instance]
        };
    }

    // Position is the index in the target children after removing the node from its old parent.
    public static DocumentStructure MoveNode(DocumentStructure document, Guid nodeId, Guid targetParentId, int position)
    {
        IReadOnlyList<Guid> Children(Guid parentId, IReadOnlyList<Guid> children)
        {
            var result = children.Where(id => id != nodeId).ToList();
            if (parentId == targetParentId) result.Insert(position, nodeId);
            return result.ToArray();
        }
        return document with
        {
            Screens = document.Screens.Select(s => s with { ChildIds = Children(s.Id, s.ChildIds) }).ToArray(),
            Nodes = document.Nodes.Select(n => n with { ChildIds = Children(n.Id, n.ChildIds) }).ToArray()
        };
    }

    public static DocumentStructure DeletePage(DocumentStructure document, Guid pageId)
    {
        var page = document.Pages.FirstOrDefault(p => p.Id == pageId)
            ?? throw new InvalidOperationException("Page does not exist.");
        var screens = page.ScreenIds.ToHashSet();
        var nodes = document.Nodes.ToDictionary(n => n.Id);
        var removed = new HashSet<Guid>();
        var pending = new Stack<Guid>(document.Screens.Where(s => screens.Contains(s.Id)).SelectMany(s => s.ChildIds));
        while (pending.TryPop(out var id))
            if (removed.Add(id)) foreach (var child in nodes[id].ChildIds) pending.Push(child);
        return document with
        {
            Pages = document.Pages.Where(p => p.Id != pageId).ToArray(),
            Screens = document.Screens.Where(s => !screens.Contains(s.Id)).ToArray(),
            Nodes = document.Nodes.Where(n => !removed.Contains(n.Id)).ToArray(),
            ComponentInstances = document.ComponentInstances.Where(i => !removed.Contains(i.NodeId)).ToArray()
        };
    }

    public static DocumentStructure DeleteNode(DocumentStructure document, Guid nodeId)
    {
        var nodes = document.Nodes.ToDictionary(n => n.Id);
        if (!nodes.ContainsKey(nodeId)) throw new InvalidOperationException("Node does not exist.");
        var removed = new HashSet<Guid>();
        var pending = new Stack<Guid>();
        pending.Push(nodeId);
        while (pending.TryPop(out var id))
        {
            if (!removed.Add(id)) continue;
            foreach (var child in nodes[id].ChildIds) pending.Push(child);
        }
        return document with
        {
            Screens = document.Screens.Select(s => s with { ChildIds = s.ChildIds.Where(id => id != nodeId).ToArray() }).ToArray(),
            ComponentInstances = document.ComponentInstances.Where(i => !removed.Contains(i.NodeId)).ToArray(),
            Nodes = document.Nodes.Where(n => !removed.Contains(n.Id))
                .Select(n => n with { ChildIds = n.ChildIds.Where(id => id != nodeId).ToArray() }).ToArray()
        };
    }
}

public sealed record StructureError(string Code, Guid ObjectId, Guid? ReferenceId, string Message, string? Property = null);

public static class DocumentStructureLimits
{
    public const int MaxTreeDepth = 128;
}

public static class DocumentStructureValidator
{
    public static IReadOnlyList<StructureError> Validate(DocumentStructure document, INodeProfile profile)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (PortableUiProfileResolver.Resolve(document.Profile, profile, out var selected) is { } error)
            return [new(error.Code, document.Id, null, error.Message, "profile")];
        profile = selected!;
        var structureErrors = ValidateStructure(document, profile);
        if (structureErrors.Count != 0) return structureErrors;
        if (document.ComponentInstances is null || document.ComponentInstances.Any(i => i is null ||
                i.ParameterOverrides is null || i.SlotContent is null || i.SlotContent.Values.Any(v => v is null)) ||
            document.ComponentDefinitions is null || document.ComponentDefinitions.Any(d => d is null ||
                d.Parameters is null || d.Slots is null || d.Variants is null || d.Bindings is null))
            return [new("invalid-components", document.Id, null, "Component definitions, instances and their contracts are required.")];
        return ComponentValidator.Validate(new(document, document.ComponentDefinitions, document.ComponentInstances, document.Tokens, document.Assets.Select(a => a.Id).ToArray()), profile)
            .Select(e => new StructureError(e.Code, e.ObjectId, e.ReferenceId, e.Message, e.Property)).ToArray();
    }

    internal static IReadOnlyList<StructureError> ValidateStructure(DocumentStructure document, INodeProfile profile, bool validateRepeaters = true)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(profile);
        if (PortableUiProfileResolver.Resolve(document.Profile, profile, out var selected) is { } profileError)
            return [new(profileError.Code, document.Id, null, profileError.Message, "profile")];
        profile = selected!;
        var errors = new List<StructureError>();
        if (!DocumentNameValidator.IsValid(document.Name)) errors.Add(new("INVALID_DOCUMENT_NAME", document.Id, null, "Document name is invalid.", "name"));
        var kinds = new Dictionary<Guid, string>();
        void Register(Guid id, string kind)
        {
            if (id == Guid.Empty)
                errors.Add(new("empty-id", id, null, $"{kind} must have a nonempty ID."));
            if (!kinds.TryAdd(id, kind))
                errors.Add(new("duplicate-id", id, null, $"ID is used by more than one object, including {kind}."));
        }
        if (document.Tokens is null || document.Tokens.Any(t => t is null)) { errors.Add(new("invalid-tokens", document.Id, null, "Tokens are required.")); return errors; }
        if (!DatasetValidator.IsValid(document.Datasets)) { errors.Add(new("INVALID_DATASET", document.Id, null, "Datasets or fixtures are invalid or exceed their limits.")); return errors; }
        if (document.Scenarios is null || document.Scenarios.Any(s => s is null)) return [new("INVALID_SCENARIO", document.Id, null, "Scenarios are required.")];
        if (!DocumentAssetValidator.IsValid(document.Assets)) return [new("INVALID_ASSET_MANIFEST", document.Id, null, "Asset manifest is invalid or exceeds its limits.")];
        foreach (var asset in document.Assets) Register(asset.Id, "asset");
        foreach (var scenario in document.Scenarios) Register(scenario.Id, "scenario");
        errors.AddRange(DocumentScenarioValidator.Validate(document, profile));
        foreach (var dataset in document.Datasets) Register(dataset.Id, "dataset");
        foreach (var token in document.Tokens) Register(token.Id, "token");
        var tokens = new DesignTokenResolver(document.Tokens);
        errors.AddRange(DesignTokenValidator.Validate(document.Tokens).Select(e => new StructureError(e.Code, e.TokenId, e.ReferenceId, e.Message)));
        Register(document.Id, "document");
        foreach (var page in document.Pages) Register(page.Id, "page");
        foreach (var screen in document.Screens) Register(screen.Id, "screen");
        foreach (var node in document.Nodes) Register(node.Id, "node");
        foreach (var screen in document.Screens)
        {
            if (!ScreenDimensions.IsValid(screen.Dimensions)) errors.Add(new("INVALID_SCREEN_DIMENSIONS", screen.Id, null, "Screen width and height must be finite and non-negative."));
            if (screen.Variants is null) { errors.Add(new("INVALID_SCREEN_VARIANT", screen.Id, null, "Screen variants are required.")); continue; }
            foreach (var variant in screen.Variants)
                if (variant is not null) Register(variant.Id, "screen variant");
            errors.AddRange(ScreenVariantValidator.Validate(document, screen, profile, tokens));
        }

        bool Reference(Guid owner, Guid target, string expected)
        {
            if (!kinds.TryGetValue(target, out var actual))
            {
                errors.Add(new("missing-reference", owner, target, $"Referenced {expected} does not exist."));
                return false;
            }
            if (actual != expected)
            {
                errors.Add(new("wrong-reference-type", owner, target, $"Expected {expected}, found {actual}."));
                return false;
            }
            return true;
        }

        foreach (var page in document.Pages)
        {
            if (!PageNameValidator.IsValid(page.Name)) errors.Add(new("invalid-page-name", page.Id, null, "Page name is invalid."));
            foreach (var id in page.ScreenIds)
                Reference(page.Id, id, "screen");
        }

        var parents = new Dictionary<Guid, int>();
        var edges = new Dictionary<Guid, List<Guid>>();
        void Children(Guid owner, IReadOnlyList<Guid> children)
        {
            if (!edges.TryGetValue(owner, out var targets)) edges[owner] = targets = [];
            foreach (var id in children)
            {
                if (!Reference(owner, id, "node")) continue;
                targets.Add(id);
                parents[id] = parents.GetValueOrDefault(id) + 1;
            }
        }
        foreach (var screen in document.Screens) Children(screen.Id, screen.ChildIds);
        foreach (var node in document.Nodes)
        {
            if (!NodeMetadataValidator.IsValidName(node.Name) || !NodeMetadataValidator.IsValidSemanticKey(node.SemanticKey))
                errors.Add(new("INVALID_NODE_METADATA", node.Id, null, "Node metadata exceeds its limits or contains control characters."));
            if (!profile.IsKnownKind(node.Kind))
                errors.Add(new("unknown-node-kind", node.Id, null, $"Node kind '{node.Kind}' is not in the profile."));
            else if (node.ChildIds.Count > 0 && !profile.CanContainChildren(node.Kind))
                errors.Add(new("children-not-allowed", node.Id, null, $"Node kind '{node.Kind}' cannot contain children."));
            errors.AddRange(ValidateNodeProperties(document, node, profile, tokens));
            if (node.DataBindings is null) errors.Add(new("INVALID_DATA_BINDING", node.Id, null, "Data bindings are required."));
            else foreach (var (property, binding) in node.DataBindings)
                if (NodeDataBindingEvaluator.Validate(document, node, property, binding, profile) is { } bindingError)
                    errors.Add(new(bindingError.Code, node.Id, binding?.DatasetId, bindingError.Message, property));
            if (validateRepeaters && node.Repeater is { } repeater && NodeRepeaterEvaluator.Validate(document, node, repeater, profile) is { } repeaterError)
                errors.Add(new(repeaterError.Code, node.Id, repeater.DatasetId, repeaterError.Message, "repeater"));
            Children(node.Id, node.ChildIds);
        }
        foreach (var node in document.Nodes)
            if (parents.GetValueOrDefault(node.Id) != 1)
                errors.Add(new("node-ownership", node.Id, null, "Node must have exactly one structural parent."));

        // Check every component, including disconnected cycles, without recursive stack growth.
        var color = new Dictionary<Guid, int>();
        foreach (var start in edges.Keys)
        {
            if (color.GetValueOrDefault(start) != 0) continue;
            var stack = new Stack<(Guid Id, int Next)>();
            color[start] = 1;
            stack.Push((start, 0));
            while (stack.TryPop(out var frame))
            {
                if (!edges.TryGetValue(frame.Id, out var children) || frame.Next == children.Count)
                {
                    color[frame.Id] = 2;
                    continue;
                }
                stack.Push((frame.Id, frame.Next + 1));
                var child = children[frame.Next];
                if (color.GetValueOrDefault(child) == 1)
                    errors.Add(new("cycle", frame.Id, child, "Structural references form a cycle."));
                else if (color.GetValueOrDefault(child) == 0)
                {
                    color[child] = 1;
                    stack.Push((child, 0));
                }
            }
        }
        return errors;
    }

    internal static IEnumerable<StructureError> ValidateNodeProperties(DocumentStructure document, NodeStructure node, INodeProfile profile,
        DesignTokenResolver tokens, TokenTheme? theme = null)
    {
        if (node.Properties is null)
        {
            yield return new("invalid-properties", node.Id, null, "Properties are required.");
            yield break;
        }
        if (profile.Kinds.FirstOrDefault(kind => kind.Kind == node.Kind) is { } kind)
            foreach (var (property, definition) in kind.Properties)
                if (definition.Required && !node.Properties.ContainsKey(property))
                    yield return new("REQUIRED_PROPERTY", node.Id, null, $"Property '{property}' is required for '{node.Kind}'.", property);

        foreach (var (property, value) in node.Properties)
        {
            if (NodePropertyValidator.Validate(profile, node.Kind, property, value) is { } error)
                yield return new(error.Code, node.Id, null, error.Reason, property);
            else if (NodePropertyValidator.ValidateReference(document, tokens, profile.GetProperty(node.Kind, property), property, value, theme) is { } reference)
                yield return new(reference.Code, node.Id, reference.Id, reference.Reason, property);
        }
    }
}


public static class NodeMetadataValidator
{
    public static bool IsValidName(string? value) => value is not null && value.Length <= 256 && !value.Any(char.IsControl);
    public static bool IsValidSemanticKey(string? value) => value is null || value.Length is > 0 and <= 256 && !string.IsNullOrWhiteSpace(value) && !value.Any(char.IsControl);
}

public static class DocumentNameValidator
{
    public static bool IsValid(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 256 && !value.Any(char.IsControl);
}

public static class PageNameValidator
{
    public static bool IsValid(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 256 && !value.Any(char.IsControl);
}
