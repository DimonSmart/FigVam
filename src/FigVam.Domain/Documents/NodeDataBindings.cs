using System.Text.Json;

namespace FigVam.Domain.Documents;

public sealed record NodeDataBinding(Guid DatasetId, DataBinding Binding);
public sealed record NodeDataResult(NodePropertyValue? Value, DataDiagnostic? Diagnostic);

public static class NodeDataBindingEvaluator
{
    public static DataDiagnostic? Validate(DocumentStructure document, NodeStructure node, string property, NodeDataBinding? binding, INodeProfile profile)
    {
        if (binding is null) return new("INVALID_DATA_BINDING", "A dataset and binding are required.");
        if (!document.Datasets.Any(d => d.Id == binding.DatasetId)) return new("DATASET_NOT_FOUND", "The referenced local dataset does not exist.");
        if (DataBindingEvaluator.Validate(binding.Binding) is { } error) return new("INVALID_DATA_BINDING", error.Message);
        if (document.ComponentDefinitions?.Any(d => d?.Bindings?.Any(b => b.NodeId == node.Id && b.Property == property) == true) == true)
            return new("INVALID_DATA_BINDING", "The property is already bound to a component parameter.");
        var definition = profile.GetProperty(node.Kind, property);
        if (definition is null) return new("UNSUPPORTED_PROPERTY", "The current profile does not support this node property.");
        var expected = definition.Type switch { NodePropertyType.String => DataExpectedType.String, NodePropertyType.Number => DataExpectedType.Number,
            NodePropertyType.Boolean => DataExpectedType.Boolean, _ => DataExpectedType.Any };
        if (expected == DataExpectedType.Any) return new("INVALID_PROPERTY_TYPE", "Data bindings require a string, number or boolean property.");
        var output = binding.Binding.Operation switch { DataOperation.Count => DataExpectedType.Number,
            DataOperation.IsEmpty or DataOperation.IsPresent or DataOperation.IsNull => DataExpectedType.Boolean, _ => binding.Binding.ExpectedType };
        return output != expected ? new("INVALID_PROPERTY_TYPE", "Binding output type must match the target property type.") : null;
    }

    public static NodeDataResult Evaluate(DocumentStructure document, NodeStructure node, string property, NodeDataBinding binding, INodeProfile profile)
    {
        if (Validate(document, node, property, binding, profile) is { } error) return new(null, error);
        var fixture = document.Datasets.Single(d => d.Id == binding.DatasetId).FixtureJson;
        if (!DatasetValidator.IsValidFixture(fixture)) return new(null, new("DATA_INVALID_FIXTURE", "Fixture is invalid or exceeds its limits."));
        using var json = JsonDocument.Parse(fixture);
        return Evaluate(document, node, property, binding, profile, json.RootElement);
    }

    public static NodeDataResult Evaluate(DocumentStructure document, NodeStructure node, string property, NodeDataBinding binding,
        INodeProfile profile, JsonElement data)
    {
        if (Validate(document, node, property, binding, profile) is { } error) return new(null, error);
        var result = DataBindingEvaluator.Evaluate(data, binding.Binding);
        if (result.Diagnostic is { } diagnostic) return new(null, new("DATA_" + diagnostic.Code.Replace('-', '_').ToUpperInvariant(), diagnostic.Message));
        var scalar = ToPropertyValue(result.Value!.Value);
        if (NodePropertyValidator.Validate(profile, node.Kind, property, scalar) is { } invalid) return new(null, new(invalid.Code, invalid.Reason));
        return new(scalar, null);
    }

    public static NodePropertyValue? ToPropertyValue(JsonElement value) => value.ValueKind switch {
            JsonValueKind.String => new NodeStringValue(value.GetString()!),
            JsonValueKind.Number when value.TryGetDouble(out var number) => new NodeNumberValue(number),
            JsonValueKind.True => new NodeBooleanValue(true), JsonValueKind.False => new NodeBooleanValue(false), _ => null };

}
