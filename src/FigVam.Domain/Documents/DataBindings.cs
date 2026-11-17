using System.Text.Json;

namespace FigVam.Domain.Documents;

// Paths are relative to the supplied root (the fixture or a repeater item).
[System.Text.Json.Serialization.JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DataProperty), "property")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DataIndex), "index")]
public abstract record DataPathSegment;
public sealed record DataProperty(string Name) : DataPathSegment;
public sealed record DataIndex(int Index) : DataPathSegment;
public enum DataOperation { Value, Count, IsEmpty, IsPresent, IsNull }
public enum DataExpectedType { Any, String, Number, Boolean, Object, Array }
public sealed record DataBinding(IReadOnlyList<DataPathSegment> Path, DataOperation Operation = DataOperation.Value,
    DataExpectedType ExpectedType = DataExpectedType.Any);
public sealed record DataDiagnostic(string Code, string Message);
public sealed record DataResult(JsonElement? Value, DataDiagnostic? Diagnostic)
{
    public bool Success => Diagnostic is null;
}
public sealed record RepeaterResult(IReadOnlyList<IReadOnlyList<DataResult>>? Items, DataDiagnostic? Diagnostic)
{
    public bool Success => Diagnostic is null;
}

public static class DataBindingEvaluator
{
    public const int MaxPathSegments = 32;
    public const int MaxPropertyLength = 256;
    public const int MaxRepeaterItems = 1000;
    public const int MaxRepeaterBindings = 100;
    public const int MaxRepeaterWork = 10000;

    public static DataResult EvaluateFixture(string? fixtureJson, DataBinding? binding)
    {
        if (!DatasetValidator.IsValidFixture(fixtureJson)) return Error("invalid-fixture", "Fixture is invalid or exceeds its limits.");
        using var document = JsonDocument.Parse(fixtureJson!);
        return Evaluate(document.RootElement, binding);
    }

    public static DataDiagnostic? Validate(DataBinding? binding)
    {
        if (binding?.Path is null || binding.Path.Count > MaxPathSegments ||
            !Enum.IsDefined(binding.Operation) || !Enum.IsDefined(binding.ExpectedType))
            return new("invalid-path", "Binding or path is invalid or exceeds its limits.");
        foreach (var segment in binding.Path)
            if (segment switch
                {
                    DataProperty p => string.IsNullOrEmpty(p.Name) || p.Name.Length > MaxPropertyLength || p.Name.Any(char.IsControl),
                    DataIndex i => i.Index < 0,
                    _ => true
                }) return new("invalid-path", "Path contains an invalid segment.");

        return null;
    }

    public static DataResult Evaluate(JsonElement root, DataBinding? binding)
    {
        if (Validate(binding) is { } diagnostic) return new(null, diagnostic);

        var value = root;
        var missing = false;
        foreach (var segment in binding!.Path)
        {
            if (segment is DataProperty property)
            {
                if (value.ValueKind != JsonValueKind.Object) return Error("incompatible-type", "A property requires an object.");
                if (!value.TryGetProperty(property.Name, out value)) { missing = true; break; }
            }
            else if (segment is DataIndex index)
            {
                if (value.ValueKind != JsonValueKind.Array) return Error("incompatible-type", "An index requires an array.");
                if (index.Index >= value.GetArrayLength()) { missing = true; break; }
                value = value[index.Index];
            }
        }
        if (binding.Operation == DataOperation.IsPresent) return Scalar(!missing);
        if (missing) return Error("missing-value", "The requested property or array item is missing.");
        if (binding.Operation == DataOperation.IsNull) return Scalar(value.ValueKind == JsonValueKind.Null);
        if (binding.Operation is DataOperation.Count or DataOperation.IsEmpty)
        {
            if (value.ValueKind != JsonValueKind.Array) return Error("incompatible-type", "Count and isEmpty require an array.");
            return binding.Operation == DataOperation.Count ? Scalar(value.GetArrayLength()) : Scalar(value.GetArrayLength() == 0);
        }
        var matches = binding.ExpectedType switch
        {
            DataExpectedType.Any => value.ValueKind != JsonValueKind.Undefined,
            DataExpectedType.String => value.ValueKind == JsonValueKind.String,
            DataExpectedType.Number => value.ValueKind == JsonValueKind.Number,
            DataExpectedType.Boolean => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
            DataExpectedType.Object => value.ValueKind == JsonValueKind.Object,
            DataExpectedType.Array => value.ValueKind == JsonValueKind.Array,
            _ => false
        };
        return matches ? new(value.Clone(), null) : Error("incompatible-type", "Value does not match the expected type.");
    }

    // All item bindings share one work budget, including traversal of each path.
    public static RepeaterResult EvaluateRepeater(JsonElement root, DataBinding? items, IReadOnlyList<DataBinding>? itemBindings)
    {
        if (items is null || items.Operation != DataOperation.Value || itemBindings is null || itemBindings.Count > MaxRepeaterBindings)
            return new(null, new("invalid-repeater", "Repeater configuration is invalid or exceeds its limits."));
        var array = Evaluate(root, items with { ExpectedType = DataExpectedType.Array });
        if (!array.Success) return new(null, array.Diagnostic);
        var count = array.Value!.Value.GetArrayLength();
        if (count > MaxRepeaterItems || itemBindings.Any(b => b?.Path is null || b.Path.Count > MaxPathSegments) ||
            (long)count * itemBindings.Sum(b => (long)b.Path.Count + 1) > MaxRepeaterWork)
            return new(null, new("repeater-limit", "Repeater exceeds its work limit."));
        var results = new List<IReadOnlyList<DataResult>>(count);
        foreach (var item in array.Value.Value.EnumerateArray())
            results.Add(itemBindings.Select(binding => Evaluate(item, binding)).ToArray());
        return new(results, null);
    }

    private static DataResult Error(string code, string message) => new(null, new(code, message));
    private static DataResult Scalar<T>(T value) => new(JsonSerializer.SerializeToElement(value), null);
}
