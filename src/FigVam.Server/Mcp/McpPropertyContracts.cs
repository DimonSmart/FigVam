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
    [property: JsonRequired] JsonElement Color);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpScalarInput([property: JsonRequired] JsonElement Value);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record McpRgbaInput(
    [property: JsonRequired] byte Red,
    [property: JsonRequired] byte Green,
    [property: JsonRequired] byte Blue,
    [property: JsonRequired] byte Alpha);

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
            AllowDuplicateProperties = false,
            AllowOutOfOrderMetadataProperties = true
        };
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }

    internal static T Read<T>(JsonElement value) where T : class =>
        value.Deserialize<T>(InputOptions) ?? throw new JsonException("Expected a non-null object.");

    private static JsonObject Schema<T>() =>
        InputOptions.GetJsonSchemaAsNode(typeof(T), ExportOptions).AsObject();

    private static JsonObject Choice(params JsonObject[] alternatives) =>
        new() { ["anyOf"] = new JsonArray(alternatives) };

    private static JsonObject ObjectSchema(JsonObject properties, params string[] required) =>
        new()
        {
            ["type"] = "object", ["properties"] = properties, ["additionalProperties"] = false,
            ["required"] = new JsonArray(required.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray())
        };

    private static JsonObject WithTag(JsonObject schema, string tag, bool required = false, string field = "type")
    {
        schema["properties"]!.AsObject()[field] = new JsonObject { ["type"] = "string", ["const"] = tag };
        if (required) schema["required"]!.AsArray().Add(JsonValue.Create(field));
        return schema;
    }

    private static JsonObject TaggedScalar(JsonObject scalar, string tag, string field = "value") =>
        WithTag(ObjectSchema(new JsonObject { [field] = scalar.DeepClone() }, field), tag, required: true);

    private static JsonObject HexSchema()
    {
        var schema = Schema<string>();
        schema["pattern"] = ColorPattern;
        schema["description"] = "Hex color: #RRGGBB or #RRGGBBAA (alpha last).";
        return schema;
    }

    private static JsonObject RgbaSchema(bool tagged = false)
    {
        var schema = Schema<McpRgbaInput>();
        foreach (var channel in schema["properties"]!.AsObject())
        {
            channel.Value!["minimum"] = 0;
            channel.Value["maximum"] = 255;
        }
        return WithTag(schema, "color", tagged);
    }

    private static JsonObject ColorSchema() => Choice(HexSchema(), RgbaSchema());

    private static JsonObject ReferenceSchema<T>(string? tag = null, string field = "type") where T : class
    {
        var schema = Schema<T>();
        // The document validator also checks that the ID exists and matches the required type.
        foreach (var property in schema["properties"]!.AsObject())
        {
            property.Value!["format"] = "uuid";
            property.Value["not"] = new JsonObject { ["const"] = Guid.Empty.ToString() };
        }
        return tag is null ? schema : WithTag(schema, tag, field: field);
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
        return WithTag(schema, "shadow");
    }

    private static JsonObject CompactTokenLiteral(TokenType type) => type switch
        {
            TokenType.Color => ColorSchema(),
            TokenType.Spacing or TokenType.Geometry or TokenType.Dimension or TokenType.Number => Schema<double>(),
            TokenType.FontFamily => Schema<string>(),
            TokenType.FontWeight => Schema<int>(),
            TokenType.Typography => Schema<McpTypographyInput>(),
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };

    private static JsonObject CanonicalTokenLiteral(TokenType type)
    {
        if (type == TokenType.Color)
        {
            var schema = RgbaSchema(tagged: true);
            var required = schema["required"]!.AsArray();
            required.Remove(required.Single(v => v!.GetValue<string>() == "alpha"));
            return schema;
        }
        if (type == TokenType.Typography)
        {
            var flat = WithTag(Schema<McpTypographyInput>(), "typography", required: true);
            flat["additionalProperties"] = false;
            var fields = ObjectSchema(new JsonObject
            {
                ["fontFamily"] = TokenExpressionSchema(TokenType.FontFamily),
                ["fontSize"] = TokenExpressionSchema(TokenType.Dimension),
                ["fontWeight"] = TokenExpressionSchema(TokenType.FontWeight),
                ["lineHeight"] = TokenExpressionSchema(TokenType.Number),
                ["letterSpacing"] = TokenExpressionSchema(TokenType.Dimension)
            }, "fontFamily", "fontSize", "fontWeight", "lineHeight");
            return Choice(flat, WithTag(fields, "typographyFields", required: true));
        }
        var tag = type switch
        {
            TokenType.Spacing => "spacing", TokenType.Geometry => "geometry",
            TokenType.Dimension => "dimension", TokenType.Number => "number",
            TokenType.FontFamily => "fontFamily", TokenType.FontWeight => "fontWeight",
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };
        return TaggedScalar(CompactTokenLiteral(type), tag, type == TokenType.Geometry ? "radius" : "value");
    }

    private static JsonObject AliasExpressionSchema() =>
        WithTag(ReferenceSchema<McpTokenReferenceInput>(), "alias", required: true, field: "expression");

    private static JsonObject LiteralExpressionSchema(TokenType type) =>
        WithTag(ObjectSchema(new JsonObject { ["value"] = CanonicalTokenLiteral(type) }, "value"),
            "literal", required: true, field: "expression");

    private static JsonObject TokenExpressionSchema(TokenType type) =>
        Choice(AliasExpressionSchema(), LiteralExpressionSchema(type));

    internal static JsonObject TokenInputSchema(TokenType type)
    {
        var alternatives = new List<JsonObject>();
        if (type == TokenType.Color) alternatives.AddRange([HexSchema(), RgbaSchema()]);
        else alternatives.Add(CompactTokenLiteral(type));
        alternatives.AddRange([ReferenceSchema<McpTokenReferenceInput>(), AliasExpressionSchema(), LiteralExpressionSchema(type)]);
        return Choice(alternatives.ToArray());
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
            NodePropertyType.Asset => ReferenceSchema<McpAssetReferenceInput>("asset"),
            NodePropertyType.StyleReference => ReferenceSchema<McpStyleReferenceInput>("style"),
            NodePropertyType.TokenReference => ReferenceSchema<McpTokenReferenceInput>("token"),
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

        var alternatives = new JsonArray();
        if (definition.Type == NodePropertyType.Color)
            foreach (var color in literal["anyOf"]!.AsArray()) alternatives.Add(color!.DeepClone());
        else alternatives.Add(literal);
        var scalarTag = definition.Type switch
        {
            NodePropertyType.String => "string", NodePropertyType.Number => "number",
            NodePropertyType.Boolean => "boolean", NodePropertyType.Enum => "enum",
            _ => null
        };
        if (scalarTag is not null) alternatives.Add(TaggedScalar(literal, scalarTag));
        if (definition.Type == NodePropertyType.Enum && definition.NumericFontWeight)
        {
            var number = Schema<int>();
            if (definition.Minimum is { } min) number["minimum"] = min;
            if (definition.Maximum is { } max) number["maximum"] = max;
            alternatives.Add(number);
            alternatives.Add(TaggedScalar(number, "number"));
        }
        if (definition.TokenType is not null &&
            definition.Type is NodePropertyType.Number or NodePropertyType.Color or NodePropertyType.String or NodePropertyType.Enum)
            alternatives.Add(ReferenceSchema<McpTokenReferenceInput>("token"));

        return alternatives.Count == 1
            ? (JsonObject)literal.DeepClone()
            : new JsonObject { ["anyOf"] = alternatives };
    }
}
