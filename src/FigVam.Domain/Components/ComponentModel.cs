using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Components;

public enum ComponentParameterType { Text, Asset, Bool, Number, TokenReference, Enum }
public enum ComponentVariantKind { Default, Hover, Disabled, Selected, Custom }

[System.Text.Json.Serialization.JsonPolymorphic(TypeDiscriminatorPropertyName = "valueType")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentText), "text")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentAsset), "asset")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentBool), "bool")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentNumber), "number")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentToken), "token")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentEnum), "enum")]
public abstract record ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentText([property: System.Text.Json.Serialization.JsonRequired] string Value) : ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentAsset([property: System.Text.Json.Serialization.JsonRequired] Guid AssetId) : ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentBool([property: System.Text.Json.Serialization.JsonRequired] bool Value) : ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentNumber([property: System.Text.Json.Serialization.JsonRequired] double Value) : ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentToken([property: System.Text.Json.Serialization.JsonRequired] Guid TokenId) : ComponentValue;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentEnum([property: System.Text.Json.Serialization.JsonRequired] string Value) : ComponentValue;

public sealed record ComponentParameter(Guid Id, string Name, ComponentParameterType Type,
    ComponentValue DefaultValue, TokenType? TokenType = null, IReadOnlyList<string>? EnumValues = null,
    TokenCategory? TokenCategory = null);
public sealed record ComponentParameterBinding(Guid ParameterId, Guid NodeId, string Property);
public sealed record ComponentSlot(Guid Id, string Name, Guid ContainerNodeId);
public sealed record ComponentVariant(Guid Id, string Name, ComponentVariantKind Kind,
    Guid? BaseVariantId, IReadOnlyDictionary<Guid, ComponentValue> ParameterChanges);

// Roots, instance anchors and slot content refer to the document's single structural tree.
public sealed record ComponentDefinition(Guid Id, string Name, string Description, Guid RootNodeId,
    IReadOnlyList<ComponentParameter> Parameters, IReadOnlyList<ComponentSlot> Slots,
    IReadOnlyList<ComponentVariant> Variants)
{
    public IReadOnlyList<ComponentParameterBinding> Bindings { get; init; } = [];
}
public sealed record ComponentInstance(Guid NodeId, Guid DefinitionId, Guid? VariantId,
    IReadOnlyDictionary<Guid, ComponentValue> ParameterOverrides,
    IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> SlotContent);
public sealed record ComponentModel(DocumentStructure Structure, IReadOnlyList<ComponentDefinition> Definitions,
    IReadOnlyList<ComponentInstance> Instances, IReadOnlyList<DesignToken> Tokens, IReadOnlyList<Guid> AssetIds);
public sealed record ComponentDiagnostic(string Code, Guid ObjectId, Guid? ReferenceId, string Message, string? Property = null);
// Nodes retain definition IDs; resolving does not insert or detach an instance in the document tree.
public sealed record ResolvedComponent(Guid NodeId, Guid DefinitionId,
    IReadOnlyDictionary<Guid, ComponentValue> Parameters,
    IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> SlotContent,
    IReadOnlyList<NodeStructure> Nodes);
public sealed record ComponentReplacement(Guid DefinitionId,
    IReadOnlyDictionary<Guid, Guid> ParameterIds, IReadOnlyDictionary<Guid, Guid> SlotIds,
    IReadOnlyDictionary<Guid, Guid> VariantIds);

public static class ComponentValidator
{
    public static IReadOnlyList<ComponentDiagnostic> Validate(ComponentModel model, INodeProfile profile)
        => Validate(model, profile, true);

    internal static IReadOnlyList<ComponentDiagnostic> ValidateWithoutRepeaters(ComponentModel model, INodeProfile profile)
        => Validate(model, profile, false);

    private static IReadOnlyList<ComponentDiagnostic> Validate(ComponentModel model, INodeProfile profile, bool validateRepeaters)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(profile);
        var structure = model.Structure with { ComponentDefinitions = model.Definitions, ComponentInstances = model.Instances };
        var errors = DocumentStructureValidator.ValidateStructure(structure, profile, validateRepeaters)
            .Select(e => new ComponentDiagnostic(e.Code, e.ObjectId, e.ReferenceId, e.Message, e.Property)).ToList();
        var kinds = new Dictionary<Guid, string>();
        void Register(Guid id, string kind)
        {
            if (id == Guid.Empty) errors.Add(new("empty-id", id, null, $"{kind} ID must be nonempty."));
            if (!kinds.TryAdd(id, kind)) errors.Add(new("duplicate-id", id, null, "ID must identify one object."));
        }
        foreach (var scenario in model.Structure.Scenarios ?? []) if (scenario is not null) Register(scenario.Id, "scenario");
        foreach (var dataset in model.Structure.Datasets) Register(dataset.Id, "dataset");
        Register(model.Structure.Id, "document");
        foreach (var p in model.Structure.Pages) Register(p.Id, "page");
        foreach (var s in model.Structure.Screens)
        {
            Register(s.Id, "screen");
            foreach (var variant in s.Variants ?? [])
                if (variant is not null) Register(variant.Id, "screen variant");
        }
        foreach (var n in model.Structure.Nodes) Register(n.Id, "node");
        foreach (var t in model.Tokens) Register(t.Id, "token");
        foreach (var a in model.AssetIds) Register(a, "asset");
        foreach (var d in model.Definitions)
        {
            Register(d.Id, "component");
            foreach (var p in d.Parameters) Register(p.Id, "parameter");
            foreach (var s in d.Slots) Register(s.Id, "slot");
            foreach (var v in d.Variants) Register(v.Id, "variant");
        }
        bool Reference(Guid owner, Guid id, string kind)
        {
            if (!kinds.TryGetValue(id, out var actual))
                errors.Add(new("missing-reference", owner, id, $"Referenced {kind} does not exist."));
            else if (actual != kind)
                errors.Add(new("wrong-reference-type", owner, id, $"Expected {kind}, found {actual}."));
            else return true;
            return false;
        }
        var nodes = model.Structure.Nodes.DistinctBy(n => n.Id).ToDictionary(n => n.Id);
        var definitions = model.Definitions.DistinctBy(d => d.Id).ToDictionary(d => d.Id);
        var tokens = model.Tokens.DistinctBy(t => t.Id).ToDictionary(t => t.Id);
        var subtrees = definitions.Values.ToDictionary(d => d.Id, d => Descendants(nodes, d.RootNodeId));
        void Value(Guid owner, ComponentParameter parameter, ComponentValue value)
        {
            var matches = (parameter.Type, value) switch
            {
                (ComponentParameterType.Text, ComponentText { Value: not null }) => true,
                (ComponentParameterType.Asset, ComponentAsset) => true,
                (ComponentParameterType.Bool, ComponentBool) => true,
                (ComponentParameterType.Number, ComponentNumber number) => double.IsFinite(number.Value),
                (ComponentParameterType.TokenReference, ComponentToken) => true,
                (ComponentParameterType.Enum, ComponentEnum item) => parameter.EnumValues?.Contains(item.Value) == true,
                _ => false
            };
            if (!matches) errors.Add(new("incompatible-value", owner, parameter.Id, "Value is incompatible with the parameter contract."));
            if (value is ComponentAsset asset) Reference(owner, asset.AssetId, "asset");
            if (value is ComponentToken token && Reference(owner, token.TokenId, "token") &&
                (tokens[token.TokenId].Type != parameter.TokenType ||
                 tokens[token.TokenId].Category != parameter.TokenCategory))
                errors.Add(new("token-type-mismatch", owner, token.TokenId, "Token has an incompatible type."));
        }
        void Changes(Guid owner, ComponentDefinition definition, IReadOnlyDictionary<Guid, ComponentValue> changes)
        {
            foreach (var (id, value) in changes)
            {
                var parameter = definition.Parameters.FirstOrDefault(p => p.Id == id);
                if (parameter is null)
                    errors.Add(new("incompatible-override", owner, id, "Only declared parameters can be overridden."));
                else Value(owner, parameter, value);
            }
        }
        foreach (var d in model.Definitions)
        {
            Reference(d.Id, d.RootNodeId, "node");
            if (string.IsNullOrWhiteSpace(d.Name) || !NodeMetadataValidator.IsValidName(d.Name)) errors.Add(new("invalid-name", d.Id, null, "Component name must be nonblank and at most 256 characters without control characters."));
            if (d.Description is null || d.Description.Length > 4096 || d.Description.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t'))
                errors.Add(new("invalid-description", d.Id, null, "Component description must be text of at most 4096 characters."));
            foreach (var p in d.Parameters)
            {
                if (string.IsNullOrWhiteSpace(p.Name) || !NodeMetadataValidator.IsValidName(p.Name))
                    errors.Add(new("invalid-parameter", p.Id, null, "Parameter name must be nonblank and at most 256 characters without control characters."));
                if (!Enum.IsDefined(p.Type) ||
                    (p.Type == ComponentParameterType.TokenReference ? p.TokenType is null || !Enum.IsDefined(p.TokenType.Value) ||
                        !DesignTokenValidator.ValidCategory(p.TokenType.Value, p.TokenCategory) :
                        p.TokenType is not null || p.TokenCategory is not null) ||
                    (p.Type == ComponentParameterType.Enum ? p.EnumValues is null || p.EnumValues.Count == 0 ||
                        p.EnumValues.Any(string.IsNullOrWhiteSpace) || p.EnumValues.Distinct().Count() != p.EnumValues.Count : p.EnumValues is not null))
                    errors.Add(new("invalid-parameter", p.Id, null, "Parameter type metadata is inconsistent."));
                Value(p.Id, p, p.DefaultValue);
            }
            foreach (var s in d.Slots)
            {
                if (string.IsNullOrWhiteSpace(s.Name) || !NodeMetadataValidator.IsValidName(s.Name))
                    errors.Add(new("invalid-slot", s.Id, null, "Slot name must be nonblank and at most 256 characters without control characters."));
                if (Reference(s.Id, s.ContainerNodeId, "node") &&
                    (!subtrees[d.Id].Contains(s.ContainerNodeId) || !profile.CanContainChildren(nodes[s.ContainerNodeId].Kind)))
                    errors.Add(new("invalid-slot", s.Id, s.ContainerNodeId, "Slot must target a container in the definition subtree."));
            }
            if (d.Slots.Select(s => s.ContainerNodeId).Distinct().Count() != d.Slots.Count)
                errors.Add(new("duplicate-slot-container", d.Id, null, "A container can expose only one slot."));
            foreach (var v in d.Variants)
            {
                if (!Enum.IsDefined(v.Kind) || string.IsNullOrWhiteSpace(v.Name) || !NodeMetadataValidator.IsValidName(v.Name))
                    errors.Add(new("invalid-variant", v.Id, null, "Variant requires a known kind and a name."));
                if (v.BaseVariantId is Guid baseId && !d.Variants.Any(other => other.Id == baseId))
                    errors.Add(new("invalid-variant-base", v.Id, baseId, "Base variant must belong to the same definition."));
                Changes(v.Id, d, v.ParameterChanges);
            }
            if (d.Variants.Where(v => v.Kind != ComponentVariantKind.Custom).GroupBy(v => v.Kind).Any(g => g.Count() > 1))
                errors.Add(new("duplicate-variant-kind", d.Id, null, "Built-in variant kinds must be unique within a component."));
            Cycles(d.Variants.DistinctBy(v => v.Id).ToDictionary(v => v.Id,
                v => v.BaseVariantId is Guid id ? new[] { id } : Array.Empty<Guid>()), "variant-cycle", errors);
        }
        var instanceNodes = new HashSet<Guid>();
        foreach (var i in model.Instances)
        {
            Reference(i.NodeId, i.NodeId, "node");
            if (!instanceNodes.Add(i.NodeId)) errors.Add(new("duplicate-instance", i.NodeId, null, "Node can have only one component binding."));
            if (!Reference(i.NodeId, i.DefinitionId, "component")) continue;
            var d = definitions[i.DefinitionId];
            if (i.VariantId is Guid variant && !d.Variants.Any(v => v.Id == variant))
                errors.Add(new("invalid-instance-variant", i.NodeId, variant, "Variant must belong to the instance definition."));
            Changes(i.NodeId, d, i.ParameterOverrides);
            var assigned = new HashSet<Guid>();
            foreach (var (slot, content) in i.SlotContent)
            {
                if (!d.Slots.Any(s => s.Id == slot))
                    errors.Add(new("incompatible-slot", i.NodeId, slot, "Slot must be declared by the definition."));
                foreach (var node in content)
                {
                    if (Reference(i.NodeId, node, "node") && (!nodes.TryGetValue(i.NodeId, out var anchor) || !anchor.ChildIds.Contains(node)))
                        errors.Add(new("slot-ownership", i.NodeId, node, "Slot content must be a structural child of the instance anchor."));
                    if (!assigned.Add(node)) errors.Add(new("multiple-slot-assignment", i.NodeId, node, "Content can fill only one slot."));
                }
            }
        }
        Cycles(definitions.Keys.ToDictionary(id => id, id => model.Instances
            .Where(i => subtrees[id].Contains(i.NodeId)).Select(i => i.DefinitionId).ToArray()), "component-cycle", errors);
        errors.AddRange(ComponentPropertyBindings.Validate(model, profile));
        return errors;
    }

    internal static HashSet<Guid> Descendants(IReadOnlyDictionary<Guid, NodeStructure> nodes, Guid root)
    {
        var found = new HashSet<Guid>();
        var pending = new Stack<Guid>();
        pending.Push(root);
        while (pending.TryPop(out var id))
            if (found.Add(id) && nodes.TryGetValue(id, out var node))
                foreach (var child in node.ChildIds) pending.Push(child);
        return found;
    }

    private static void Cycles(IReadOnlyDictionary<Guid, Guid[]> edges, string code, List<ComponentDiagnostic> errors)
    {
        var colors = new Dictionary<Guid, int>();
        foreach (var start in edges.Keys)
        {
            if (colors.GetValueOrDefault(start) != 0) continue;
            var pending = new Stack<(Guid Id, bool Exit)>();
            pending.Push((start, false));
            while (pending.TryPop(out var item))
            {
                if (item.Exit) { colors[item.Id] = 2; continue; }
                if (colors.GetValueOrDefault(item.Id) == 2) continue;
                if (colors.GetValueOrDefault(item.Id) == 1)
                {
                    errors.Add(new(code, item.Id, item.Id, "Dependencies form a cycle."));
                    continue;
                }
                colors[item.Id] = 1;
                pending.Push((item.Id, true));
                if (edges.TryGetValue(item.Id, out var children))
                    foreach (var child in children.Reverse())
                        if (edges.ContainsKey(child)) pending.Push((child, false));
            }
        }
    }
}

public static class ComponentOperations
{
    public static ComponentModel AddDefinition(ComponentModel model, ComponentDefinition definition, INodeProfile profile)
    {
        var changed = model with { Definitions = [.. model.Definitions, definition] };
        RequireValid(changed, profile);
        return changed;
    }

    public static ComponentModel UpdateDefinition(ComponentModel model, ComponentDefinition definition, INodeProfile profile)
    {
        if (!model.Definitions.Any(d => d.Id == definition.Id)) throw new InvalidOperationException("Component does not exist.");
        var changed = model with { Definitions = model.Definitions.Select(d => d.Id == definition.Id ? definition : d).ToArray() };
        RequireValid(changed, profile);
        return changed;
    }

    public static ComponentModel AddInstance(ComponentModel model, ComponentInstance instance, INodeProfile profile)
    {
        var changed = model with { Instances = [.. model.Instances, instance] };
        RequireValid(changed, profile);
        return changed;
    }

    public static ResolvedComponent Resolve(ComponentModel model, Guid nodeId, INodeProfile profile)
    {
        RequireValid(model, profile);
        return ResolveValidated(model, nodeId);
    }

    internal static ResolvedComponent ResolveValidated(ComponentModel model, Guid nodeId)
    {
        var instance = model.Instances.Single(i => i.NodeId == nodeId);
        var definition = model.Definitions.Single(d => d.Id == instance.DefinitionId);
        var values = definition.Parameters.ToDictionary(p => p.Id, p => p.DefaultValue);
        var chain = new Stack<ComponentVariant>();
        var variantId = instance.VariantId;
        while (variantId is Guid id)
        {
            var variant = definition.Variants.Single(v => v.Id == id);
            chain.Push(variant);
            variantId = variant.BaseVariantId;
        }
        foreach (var variant in chain)
            foreach (var (id, value) in variant.ParameterChanges) values[id] = value;
        foreach (var (id, value) in instance.ParameterOverrides) values[id] = value;
        var definitionNodes = ComponentPropertyBindings.Resolve(model.Structure, definition, values);
        var nodes = model.Structure.Nodes.ToDictionary(n => n.Id);
        var supplied = instance.SlotContent.Values.SelectMany(c => c)
            .SelectMany(id => ComponentValidator.Descendants(nodes, id)).ToHashSet();
        var resolvedNodes = definitionNodes.Select(n =>
        {
            var slot = definition.Slots.SingleOrDefault(s => s.ContainerNodeId == n.Id);
            return slot is not null && instance.SlotContent.TryGetValue(slot.Id, out var content)
                ? n with { ChildIds = [.. n.ChildIds, .. content] } : n;
        }).Concat(model.Structure.Nodes.Where(n => supplied.Contains(n.Id))).ToArray();
        return new(instance.NodeId, definition.Id, values,
            instance.SlotContent.ToDictionary(p => p.Key, p => (IReadOnlyList<Guid>)p.Value.ToArray()),
            resolvedNodes);
    }

    public static IReadOnlyList<Guid> FindUsages(ComponentModel model, Guid definitionId) =>
        model.Instances.Where(i => i.DefinitionId == definitionId).Select(i => i.NodeId).ToArray();

    public static ComponentModel Detach(ComponentModel model, Guid nodeId, INodeProfile profile)
    {
        RequireValid(model, profile);
        if (!model.Instances.Any(i => i.NodeId == nodeId))
            throw new InvalidOperationException("Node is not a component instance.");

        var allocated = new HashSet<Guid>([model.Structure.Id,
            .. model.Structure.Pages.Select(p => p.Id), .. model.Structure.Screens.Select(s => s.Id),
            .. model.Structure.Screens.SelectMany(s => s.Variants.Select(v => v.Id)),
            .. model.Structure.Nodes.Select(n => n.Id), .. model.Tokens.Select(t => t.Id), .. model.AssetIds,
            .. model.Definitions.SelectMany(d => new[] { d.Id }.Concat(d.Parameters.Select(p => p.Id))
                .Concat(d.Slots.Select(s => s.Id)).Concat(d.Variants.Select(v => v.Id)))]);
        Guid AllocateNodeId()
        {
            Guid id;
            do id = Guid.NewGuid(); while (id == Guid.Empty || !allocated.Add(id));
            return id;
        }

        // Keep the external anchor identity and structural position. All definition
        // descendants are copies; supplied slot content keeps its existing identity.
        ComponentModel Materialize(ComponentModel source, Guid anchorId)
        {
            var instance = source.Instances.Single(i => i.NodeId == anchorId);
            var definition = source.Definitions.Single(d => d.Id == instance.DefinitionId);
            var resolved = Resolve(source, anchorId, profile);
            var anchor = source.Structure.Nodes.Single(n => n.Id == anchorId);
            var definitionNodes = ComponentPropertyBindings.Resolve(source.Structure, definition, resolved.Parameters);
            var ids = definitionNodes.ToDictionary(n => n.Id,
                n => n.Id == definition.RootNodeId ? anchorId : AllocateNodeId());
            var supplied = instance.SlotContent.Values.SelectMany(c => c).ToHashSet();
            var copies = definitionNodes.Select(n =>
            {
                var children = n.ChildIds.Select(id => ids[id]).ToList();
                var slot = definition.Slots.SingleOrDefault(s => s.ContainerNodeId == n.Id);
                if (slot is not null && instance.SlotContent.TryGetValue(slot.Id, out var content))
                    children.AddRange(content);
                if (n.Id == definition.RootNodeId)
                    children.AddRange(anchor.ChildIds.Where(id => !supplied.Contains(id)));
                return n with { Id = ids[n.Id], ChildIds = children.ToArray() };
            }).ToArray();
            var nested = source.Instances.Where(i => ids.ContainsKey(i.NodeId)).Select(i => i with
            {
                NodeId = ids[i.NodeId],
                ParameterOverrides = i.ParameterOverrides.ToDictionary(p => p.Key, p => p.Value),
                SlotContent = i.SlotContent.ToDictionary(p => p.Key,
                    p => (IReadOnlyList<Guid>)p.Value.Select(id => ids[id]).ToArray())
            });
            var changed = source with
            {
                Structure = source.Structure with
                {
                    Nodes = source.Structure.Nodes.SelectMany(n => n.Id == anchorId ? copies : [n]).ToArray()
                },
                Instances = source.Instances.Where(i => i.NodeId != anchorId).Concat(nested).ToArray()
            };
            RequireValid(changed, profile);
            return changed;
        }

        var result = Materialize(model, nodeId);
        while (true)
        {
            var descendants = ComponentValidator.Descendants(result.Structure.Nodes.ToDictionary(n => n.Id), nodeId);
            var nested = result.Instances.FirstOrDefault(i => descendants.Contains(i.NodeId));
            if (nested is null) return result;
            result = Materialize(result, nested.NodeId);
        }
    }

    public static ComponentModel Rename(ComponentModel model, Guid definitionId, string name, INodeProfile profile)
    {
        if (!model.Definitions.Any(d => d.Id == definitionId)) throw new InvalidOperationException("Component does not exist.");
        var changed = model with { Definitions = model.Definitions.Select(d => d.Id == definitionId ? d with { Name = name } : d).ToArray() };
        RequireValid(changed, profile);
        return changed;
    }

    public static ComponentModel DeleteDefinition(ComponentModel model, Guid definitionId, INodeProfile profile,
        ComponentReplacement? replacement = null)
    {
        RequireValid(model, profile);
        if (!model.Definitions.Any(d => d.Id == definitionId)) throw new InvalidOperationException("Component does not exist.");
        var usages = FindUsages(model, definitionId);
        if (usages.Count > 0 && replacement is null)
            throw new InvalidOperationException("In-use component requires explicit replacement or prior detachment.");
        if (replacement is not null && (replacement.DefinitionId == definitionId || !model.Definitions.Any(d => d.Id == replacement.DefinitionId)))
            throw new InvalidOperationException("Replacement must be a different existing component.");
        if (replacement is not null)
        {
            var source = model.Definitions.Single(d => d.Id == definitionId);
            var target = model.Definitions.Single(d => d.Id == replacement.DefinitionId);
            void ValidateMapping(IReadOnlyDictionary<Guid, Guid>? mapping, IEnumerable<Guid> sourceIds, IEnumerable<Guid> targetIds)
            {
                if (mapping is null || mapping.Values.Distinct().Count() != mapping.Count ||
                    mapping.Any(p => !sourceIds.Contains(p.Key) || !targetIds.Contains(p.Value)))
                    throw new InvalidOperationException("Replacement mappings must reference distinct members of the source and target definitions.");
            }
            ValidateMapping(replacement.ParameterIds, source.Parameters.Select(p => p.Id), target.Parameters.Select(p => p.Id));
            ValidateMapping(replacement.SlotIds, source.Slots.Select(p => p.Id), target.Slots.Select(p => p.Id));
            ValidateMapping(replacement.VariantIds, source.Variants.Select(p => p.Id), target.Variants.Select(p => p.Id));
            foreach (var (sourceId, targetId) in replacement.ParameterIds)
            {
                var before = source.Parameters.Single(p => p.Id == sourceId);
                var after = target.Parameters.Single(p => p.Id == targetId);
                if (before.Type != after.Type || before.TokenType != after.TokenType ||
                    (before.Type == ComponentParameterType.Enum && before.EnumValues!.Except(after.EnumValues!).Any()))
                    throw new InvalidOperationException("Mapped parameters must have compatible types and allowed values.");
            }
        }
        Guid Map(Guid source, IReadOnlyDictionary<Guid, Guid> mapping)
        {
            if (!mapping.TryGetValue(source, out var target))
                throw new InvalidOperationException($"Replacement requires an explicit mapping for {source}.");
            return target;
        }
        ComponentInstance Replace(ComponentInstance instance)
        {
            if (instance.DefinitionId != definitionId) return instance;
            var contract = replacement!;
            var parameters = instance.ParameterOverrides.ToDictionary(p => Map(p.Key, contract.ParameterIds), p => p.Value);
            var slots = instance.SlotContent.ToDictionary(p => Map(p.Key, contract.SlotIds), p => p.Value);
            return instance with
            {
                DefinitionId = contract.DefinitionId,
                VariantId = instance.VariantId is Guid variant ? Map(variant, contract.VariantIds) : null,
                ParameterOverrides = parameters,
                SlotContent = slots
            };
        }
        var changed = model with
        {
            Definitions = model.Definitions.Where(d => d.Id != definitionId).ToArray(),
            Instances = model.Instances.Select(Replace).ToArray()
        };
        RequireValid(changed, profile);
        return changed;
    }

    private static void RequireValid(ComponentModel model, INodeProfile profile)
    {
        var errors = ComponentValidator.Validate(model, profile);
        if (errors.Count > 0) throw new InvalidOperationException(string.Join("; ", errors.Select(e => $"{e.ObjectId}: {e.Code}: {e.Message}")));
    }
}
