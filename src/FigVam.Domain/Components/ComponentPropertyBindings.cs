using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Components;

internal static class ComponentPropertyBindings
{
    internal static NodePropertyValue? Convert(ComponentValue value) => value switch
    {
        ComponentText text => new NodeStringValue(text.Value),
        ComponentNumber number => new NodeNumberValue(number.Value),
        ComponentBool boolean => new NodeBooleanValue(boolean.Value),
        ComponentAsset asset => new NodeAssetValue(asset.AssetId),
        ComponentToken token => new NodeTokenValue(token.TokenId),
        ComponentEnum item => new NodeEnumValue(item.Value),
        _ => null
    };

    internal static IReadOnlyList<ComponentDiagnostic> Validate(ComponentModel model, INodeProfile profile)
    {
        var errors = new List<ComponentDiagnostic>();
        var nodes = model.Structure.Nodes.DistinctBy(n => n.Id).ToDictionary(n => n.Id);
        var tokens = new DesignTokenResolver(model.Tokens);
        foreach (var definition in model.Definitions)
        {
            var subtree = ComponentValidator.Descendants(nodes, definition.RootNodeId);
            var targets = new HashSet<(Guid, string)>();
            foreach (var binding in definition.Bindings)
            {
                void Error(string code, string message) => errors.Add(new(code, binding.NodeId,
                    binding.ParameterId, message, binding.Property));
                if (!targets.Add((binding.NodeId, binding.Property)))
                    Error("duplicate-property-binding", "A node property can be bound to only one parameter.");
                var parameter = definition.Parameters.FirstOrDefault(p => p.Id == binding.ParameterId);
                if (parameter is null)
                    Error("invalid-binding-parameter", "Binding parameter must belong to this definition.");
                if (!nodes.TryGetValue(binding.NodeId, out var node))
                {
                    Error("missing-binding-node", "Binding node does not exist.");
                    continue;
                }
                if (!subtree.Contains(node.Id))
                    Error("binding-ownership", "Binding node must belong to the definition subtree.");
                var property = profile.GetProperty(node.Kind, binding.Property);
                if (property is null)
                {
                    Error("UNSUPPORTED_PROPERTY", $"Property '{binding.Property}' is not supported for '{node.Kind}' by this profile.");
                    continue;
                }
                if (parameter is null) continue;
                var compatible = (parameter.Type, property.Type) switch
                {
                    (ComponentParameterType.Text, NodePropertyType.String) => true,
                    (ComponentParameterType.Number, NodePropertyType.Number) => true,
                    (ComponentParameterType.Bool, NodePropertyType.Boolean) => true,
                    (ComponentParameterType.Asset, NodePropertyType.Asset) => true,
                    (ComponentParameterType.TokenReference, NodePropertyType.TokenReference or NodePropertyType.Color or NodePropertyType.Number or NodePropertyType.String or NodePropertyType.Enum) =>
                        parameter.TokenType is not null &&
                            (parameter.TokenType == property.TokenType && parameter.TokenCategory == property.TokenCategory ||
                             parameter.TokenType == property.LegacyTokenType && parameter.TokenCategory is null),
                    (ComponentParameterType.Enum, NodePropertyType.Enum) => parameter.EnumValues is not null &&
                        property.EnumValues is not null && parameter.EnumValues.All(property.EnumValues.Contains),
                    _ => false
                };
                if (!compatible) Error("incompatible-binding-type", "Parameter contract is incompatible with the target property contract.");
                var values = new[] { parameter.DefaultValue }
                    .Concat(definition.Variants.Where(v => v.ParameterChanges.ContainsKey(parameter.Id)).Select(v => v.ParameterChanges[parameter.Id]))
                    .Concat(model.Instances.Where(i => i.DefinitionId == definition.Id && i.ParameterOverrides.ContainsKey(parameter.Id))
                        .Select(i => i.ParameterOverrides[parameter.Id]));
                foreach (var value in values)
                {
                    var converted = Convert(value);
                    if (NodePropertyValidator.Validate(profile, node.Kind, binding.Property, converted) is { } error)
                        Error(error.Code, error.Reason);
                    else if (converted is NodeTokenValue token && tokens.Find(token.TokenId) is not null &&
                        NodePropertyValidator.ValidateTokenReference(tokens, property, binding.Property, token) is { } reference)
                        Error(reference.Code, reference.Reason);
                }
            }
        }
        // References stored directly on nodes share the component model's asset/token catalogs.
        foreach (var node in nodes.Values)
            if (node.Properties is not null)
                foreach (var (name, value) in node.Properties)
                {
                    if (value is NodeAssetValue asset && !model.AssetIds.Contains(asset.AssetId))
                        errors.Add(new("missing-reference", node.Id, asset.AssetId, "Referenced asset does not exist.", name));
                    if (value is NodeTokenValue token)
                    {
                        if (tokens.Find(token.TokenId) is not { } target)
                            errors.Add(new("missing-reference", node.Id, token.TokenId, "Referenced token does not exist.", name));
                        else if (profile.GetProperty(node.Kind, name) is not { } definition || !NodePropertyValidator.AcceptsToken(definition, target))
                            errors.Add(new("token-type-mismatch", node.Id, token.TokenId, "Token has an incompatible type.", name));
                    }
                }
        return errors;
    }

    internal static IReadOnlyList<NodeStructure> Resolve(DocumentStructure structure, ComponentDefinition definition,
        IReadOnlyDictionary<Guid, ComponentValue> parameters)
    {
        var subtree = ComponentValidator.Descendants(structure.Nodes.ToDictionary(n => n.Id), definition.RootNodeId);
        return structure.Nodes.Where(n => subtree.Contains(n.Id)).Select(node => node with
        {
            Properties = definition.Bindings.Where(b => b.NodeId == node.Id).Aggregate(node.Properties,
                (properties, binding) => properties.SetItem(binding.Property, Convert(parameters[binding.ParameterId])!))
        }).ToArray();
    }
}
