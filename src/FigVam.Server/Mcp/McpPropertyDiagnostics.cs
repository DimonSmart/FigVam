using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FigVam.Server.Mcp;

// Explains an already rejected value using the same schema exposed to MCP clients.
// It is deliberately not an additional validation gate.
internal static class McpPropertyDiagnostics
{
    internal static string SafePath(string path) =>
        path.Length <= 128 && !path.Any(char.IsControl) ? path : "(invalid property name)";

    internal static McpContractException Explain(string code, string path, JsonElement value,
        JsonObject schema, JsonException? exception = null)
    {
        path = SafePath(path);
        var detail = Find(path, value, schema);
        if (detail is not null)
            return new(code, detail.Message, detail.Path, detail.Expected, detail.Actual);

        // Never return the serializer's exception message or raw user strings.
        if (exception?.Path is { Length: > 1 } jsonPath && jsonPath.StartsWith("$."))
            path = SafePath(path + jsonPath[1..]);
        return new(code, $"Property '{path}' violates its declared contract.",
            path, Expected(schema), Actual(value));
    }

    private sealed record Detail(string Path, string Message, string Expected, string Actual);

    private static string? Type(JsonObject schema) => schema["type"] is JsonValue v &&
        v.TryGetValue<string>(out var type) ? type : null;

    private static string Actual(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True or JsonValueKind.False => "Boolean",
        _ => value.ValueKind.ToString()
    };

    private static string Expected(JsonObject schema)
    {
        if (schema["anyOf"] is JsonArray choices)
            return string.Join(" or ", choices.OfType<JsonObject>().Select(s =>
                s["pattern"]?.GetValue<string>() == McpPropertyContracts.ColorPattern ? "Hex color" : Expected(s)));
        if (schema["pattern"]?.GetValue<string>() == McpPropertyContracts.ColorPattern)
            return "#RRGGBB or #RRGGBBAA";
        if (schema["format"]?.GetValue<string>() == "uuid") return "GUID";
        if (schema["properties"] is JsonObject fields && fields.Count == 1 &&
            fields.First().Key is "tokenId" or "assetId" or "styleId")
            return "{ " + fields.First().Key + ": GUID }";
        if (schema["enum"] is JsonArray options)
            return string.Join(", ", options.Select(v => v!.GetValue<string>()));
        return Type(schema) switch
        {
            "number" => "Number", "integer" => "Integer", "string" => "String",
            "boolean" => "Boolean", "object" => "Object", _ => "Declared value"
        };
    }

    private static bool MatchesType(JsonElement value, JsonObject schema) => Type(schema) switch
    {
        "number" or "integer" => value.ValueKind == JsonValueKind.Number,
        "string" => value.ValueKind == JsonValueKind.String,
        "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        "object" => value.ValueKind == JsonValueKind.Object,
        _ => true
    };

    private static Detail? Find(string path, JsonElement value, JsonObject schema)
    {
        Detail Error(string expected, string actual, string? message = null) =>
            new(path, message ?? $"Property '{path}' must be {expected}.", expected, actual);

        if (schema["anyOf"] is JsonArray alternatives)
        {
            var matching = alternatives.OfType<JsonObject>().Where(s => MatchesType(value, s)).ToArray();
            if (matching.Length == 0)
                return Error(Expected(schema), Actual(value));
            if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("tokenId", out _))
            {
                var reference = matching.FirstOrDefault(s => s["properties"] is JsonObject p && p.ContainsKey("tokenId"));
                if (reference is not null) return Find(path, value, reference);
            }
            var errors = matching.Select(s => Find(path, value, s)).ToArray();
            return errors.Any(e => e is null) ? null : errors[0];
        }
        if (!MatchesType(value, schema))
            return Error(Expected(schema), Actual(value));
        if (value.ValueKind == JsonValueKind.Object && schema["properties"] is JsonObject fields)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in value.EnumerateObject())
            {
                var fieldPath = SafePath(path + "." + field.Name);
                if (!seen.Add(field.Name))
                    return new(fieldPath, $"Duplicate property '{fieldPath}'.", "Unique property", "Duplicate property");
                if (!fields.ContainsKey(field.Name) && schema["additionalProperties"] is JsonValue additional &&
                    additional.TryGetValue<bool>(out var allowed) && !allowed)
                    return new(fieldPath, $"Unknown property '{fieldPath}'. Allowed properties: {string.Join(", ", fields.Select(f => f.Key))}.",
                        "A supported property", "Unknown property");
            }
            if (schema["required"] is JsonArray required)
                foreach (var item in required)
                {
                    var key = item!.GetValue<string>();
                    if (!seen.Contains(key))
                    {
                        var fieldPath = path + "." + key;
                        return new(fieldPath, $"Required property '{fieldPath}' is missing.",
                            Expected(fields[key]!.AsObject()), "Missing");
                    }
                }
            foreach (var field in value.EnumerateObject())
                if (fields[field.Name] is JsonObject fieldSchema &&
                    Find(SafePath(path + "." + field.Name), field.Value, fieldSchema) is { } error)
                    return error;
        }
        if (value.ValueKind == JsonValueKind.String)
        {
            var str = value.GetString()!;
            if (schema["format"]?.GetValue<string>() == "uuid")
            {
                if (!value.TryGetGuid(out var id))
                    return Error("GUID", "Invalid GUID format", $"Property '{path}' must be a valid GUID.");
                if (schema["not"] is JsonObject && id == Guid.Empty)
                    return Error("Nonempty GUID", "Empty GUID");
            }
            if (schema["enum"] is JsonArray options && !options.Any(v => v!.GetValue<string>() == str))
                return Error(Expected(schema), "Unsupported enum value", $"Property '{path}' must be one of: {Expected(schema)}.");
            if (schema["maxLength"] is JsonValue maxLength && str.Length > int.Parse(maxLength.ToJsonString(), CultureInfo.InvariantCulture))
                return Error($"String with maximum length {maxLength}", $"String with length {str.Length}");
            if (schema["pattern"] is JsonValue pattern)
            {
                var match = Regex.Match(str, pattern.GetValue<string>(), RegexOptions.CultureInvariant);
                if (!match.Success || match.Length != str.Length)
                    return pattern.GetValue<string>() == McpPropertyContracts.ColorPattern
                        ? Error("#RRGGBB or #RRGGBBAA", "Invalid color format",
                            $"Property '{path}' must be a hex color in #RRGGBB or #RRGGBBAA format (alpha last).")
                        : Error("String matching the declared format", "Invalid string format");
            }
        }
        if (value.ValueKind == JsonValueKind.Number)
        {
            if (!value.TryGetDouble(out var number) || !double.IsFinite(number))
                return Error("Finite number", "Non-finite number");
            var actual = number.ToString(CultureInfo.InvariantCulture);
            if (Type(schema) == "integer" && number != Math.Truncate(number))
                return Error("Integer", actual);
            static double? Bound(JsonNode? node) => node is null ? null :
                double.Parse(node.ToJsonString(), CultureInfo.InvariantCulture);
            var min = Bound(schema["minimum"]);
            var max = Bound(schema["maximum"]);
            if (number < min || number > max)
            {
                var range = min is not null && max is not null
                    ? $"between {min.Value.ToString(CultureInfo.InvariantCulture)} and {max.Value.ToString(CultureInfo.InvariantCulture)}"
                    : min is not null ? $"at least {min.Value.ToString(CultureInfo.InvariantCulture)}"
                    : $"at most {max!.Value.ToString(CultureInfo.InvariantCulture)}";
                return Error($"Number {range}", actual, $"Property '{path}' must be {range}.");
            }
        }
        return null;
    }
}
