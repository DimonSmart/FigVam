using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;
using System.Text.Json.Serialization;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

// These are MCP wire contracts, not the persisted polymorphic domain values.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpShadowInput(
    [property: JsonRequired] double OffsetX,
    [property: JsonRequired] double OffsetY,
    [property: JsonRequired] double BlurRadius,
    [property: JsonRequired] double SpreadRadius,
    [property: JsonRequired] string Color);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpTokenReferenceInput([property: JsonRequired] Guid TokenId);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpAssetReferenceInput([property: JsonRequired] Guid AssetId);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpStyleReferenceInput([property: JsonRequired] Guid StyleId);

internal sealed record McpTypographyInput(
    [property: JsonRequired] string FontFamily,
    [property: JsonRequired] double FontSize,
    [property: JsonRequired] int FontWeight,
    [property: JsonRequired] double LineHeight,
    double LetterSpacing = 0);

internal static class McpPropertyContracts
{
    internal const string ColorPattern = "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$";
    private static readonly JsonSerializerOptions InputOptions = CreateOptions();
    private static readonly JsonSchemaExporterOptions ExportOptions = new() { TreatNullObliviousAsNonNullable = true };

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            RespectNullableAnnotations = true,
            AllowDuplicateProperties = false
        };
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }

    internal static T Read<T>(JsonElement value) where T : class =>
        value.Deserialize<T>(InputOptions) ?? throw new JsonException("Expected a non-null object.");

    private static JsonObject Schema<T>() =>
        InputOptions.GetJsonSchemaAsNode(typeof(T), ExportOptions).AsObject();

    private static JsonObject ColorSchema()
    {
        var schema = Schema<string>();
        schema["pattern"] = ColorPattern;
        schema["description"] = "Hex color: #RRGGBB or #RRGGBBAA (alpha last).";
        return schema;
    }

    private static JsonObject ReferenceSchema<T>() where T : class
    {
        var schema = Schema<T>();
        // The document validator also checks that the ID exists and matches the required type.
        foreach (var property in schema["properties"]!.AsObject())
        {
            property.Value!["format"] = "uuid";
            property.Value["not"] = new JsonObject { ["const"] = Guid.Empty.ToString() };
        }
        return schema;
    }

    private static JsonObject ShadowSchema()
    {
        var schema = Schema<McpShadowInput>();
        var properties = schema["properties"]!.AsObject();
        properties["color"] = ColorSchema();
        static void Range(JsonNode node, double minimum, double maximum)
        {
            node["minimum"] = minimum;
            node["maximum"] = maximum;
        }
        Range(properties["offsetX"]!, -NodeShadowValue.MaxOffset, NodeShadowValue.MaxOffset);
        Range(properties["offsetY"]!, -NodeShadowValue.MaxOffset, NodeShadowValue.MaxOffset);
        Range(properties["blurRadius"]!, 0, NodeShadowValue.MaxBlurRadius);
        Range(properties["spreadRadius"]!, -NodeShadowValue.MaxSpreadRadius, NodeShadowValue.MaxSpreadRadius);
        return schema;
    }

    internal static JsonObject TokenInputSchema(TokenType type)
    {
        var literal = type switch
        {
            TokenType.Color => ColorSchema(),
            TokenType.Spacing or TokenType.Geometry or TokenType.Dimension or TokenType.Number => Schema<double>(),
            TokenType.FontFamily => Schema<string>(),
            TokenType.FontWeight => Schema<int>(),
            TokenType.Typography => Schema<McpTypographyInput>(),
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };
        return new JsonObject { ["anyOf"] = new JsonArray(literal, ReferenceSchema<McpTokenReferenceInput>()) };
    }

    internal static JsonObject InputSchema(NodePropertyDefinition definition)
    {
        JsonObject literal = definition.Type switch
        {
            NodePropertyType.String => Schema<string>(),
            NodePropertyType.Number => Schema<double>(),
            NodePropertyType.Boolean => Schema<bool>(),
            NodePropertyType.Enum => new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray((definition.EnumValues ?? []).Select(v => (JsonNode?)JsonValue.Create(v)).ToArray())
            },
            NodePropertyType.Color => ColorSchema(),
            NodePropertyType.Asset => ReferenceSchema<McpAssetReferenceInput>(),
            NodePropertyType.StyleReference => ReferenceSchema<McpStyleReferenceInput>(),
            NodePropertyType.TokenReference => ReferenceSchema<McpTokenReferenceInput>(),
            NodePropertyType.Shadow => ShadowSchema(),
            _ => throw new ArgumentOutOfRangeException(nameof(definition))
        };

        if (definition.Type == NodePropertyType.Number)
        {
            if (definition.Minimum is { } min) literal["minimum"] = min;
            if (definition.Maximum is { } max) literal["maximum"] = max;
        }
        if (definition.Type == NodePropertyType.String)
        {
            if (definition.MaxLength is { } max) literal["maxLength"] = max;
            if (definition.Pattern is { } pattern) literal["pattern"] = pattern;
        }

        var alternatives = new JsonArray(literal);
        if (definition.Type == NodePropertyType.Enum && definition.NumericFontWeight)
        {
            var number = Schema<int>();
            if (definition.Minimum is { } min) number["minimum"] = min;
            if (definition.Maximum is { } max) number["maximum"] = max;
            alternatives.Add(number);
        }
        if (definition.TokenType is not null &&
            definition.Type is NodePropertyType.Number or NodePropertyType.Color or NodePropertyType.String or NodePropertyType.Enum)
            alternatives.Add(ReferenceSchema<McpTokenReferenceInput>());

        return alternatives.Count == 1
            ? (JsonObject)literal.DeepClone()
            : new JsonObject { ["anyOf"] = alternatives };
    }
}
