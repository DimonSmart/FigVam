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

    private static JsonObject ShadowTokenSchema()
    {
        var schema = ShadowSchema();
        schema["properties"]!["color"] = Choice(ColorSchema(), ReferenceSchema<McpTokenReferenceInput>());
        return schema;
    }

    private static JsonObject ApplyRange(JsonObject schema, TokenType type, TokenCategory? category = null, string? field = null)
    {
        var range = DesignTokenValidator.Range(type, category, field);
        if (range.Minimum is { } min) schema[range.ExclusiveMinimum ? "exclusiveMinimum" : "minimum"] = min;
        if (range.Maximum is { } max) schema["maximum"] = max;
        return schema;
    }

    private static JsonObject FlatTypography()
    {
        var schema = Schema<McpTypographyInput>();
        var properties = schema["properties"]!.AsObject();
        var family = properties["fontFamily"]!.AsObject();
        family["minLength"] = 1;
        family["maxLength"] = DesignTokenValidator.TypographyFontFamilyMaxLength;
        family["pattern"] = @"\S";
        foreach (var field in new[] { "fontSize", "fontWeight", "lineHeight", "letterSpacing" })
            ApplyRange(properties[field]!.AsObject(), TokenType.Typography, field: field);
        return schema;
    }

    internal static JsonObject CompactTokenLiteral(TokenType type, TokenCategory? category = null)
    {
        var schema = type switch
        {
            TokenType.Color => ColorSchema(),
            TokenType.Spacing or TokenType.Geometry or TokenType.Dimension or TokenType.Number => Schema<double>(),
            TokenType.FontFamily => Schema<string>(),
            TokenType.FontWeight => Schema<int>(),
            TokenType.Typography => FlatTypography(),
            TokenType.Shadow => ShadowTokenSchema(),
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };
        if (type == TokenType.FontFamily)
        {
            schema["minLength"] = 1;
            schema["maxLength"] = DesignTokenValidator.FontFamilyMaxLength;
            schema["pattern"] = DesignTokenValidator.FontFamilyPattern;
        }
        return ApplyRange(schema, type, category);
    }

    internal static JsonObject CanonicalTokenLiteral(TokenType type, TokenCategory? category = null)
    {
        if (type == TokenType.Color)
        {
            var schema = RgbaSchema(tagged: true);
            var required = schema["required"]!.AsArray();
            required.Remove(required.Single(v => v!.GetValue<string>() == "alpha"));
            schema["properties"]!["alpha"]!["default"] = 255;
            return schema;
        }
        if (type == TokenType.Shadow)
        {
            var schema = ShadowSchema();
            schema["required"]!.AsArray().Add(JsonValue.Create("type"));
            var color = Schema<McpRgbaInput>();
            var required = color["required"]!.AsArray();
            required.Remove(required.Single(v => v!.GetValue<string>() == "alpha"));
            color["properties"]!["alpha"]!["default"] = 255;
            foreach (var channel in color["properties"]!.AsObject())
            {
                channel.Value!["minimum"] = 0;
                channel.Value["maximum"] = 255;
            }
            schema["properties"]!["color"] = color;
            var fields = (JsonObject)schema.DeepClone();
            fields["properties"]!["type"] = new JsonObject { ["const"] = "shadowFields" };
            fields["properties"]!["color"] = TokenExpressionSchema(TokenType.Color);
            return Choice(schema, fields);
        }
        if (type == TokenType.Typography)
        {
            var flat = WithTag(FlatTypography(), "typography", required: true);
            flat["additionalProperties"] = false;
            var properties = new JsonObject();
            foreach (var (name, contract) in DesignTokenValidator.TypographyFieldTypes)
                properties[name] = TokenExpressionSchema(contract.Type, contract.Category);
            properties["letterSpacing"] = Choice(properties["letterSpacing"]!.DeepClone().AsObject(), new JsonObject { ["type"] = "null" });
            var fields = ObjectSchema(properties, properties.Select(p => p.Key).Where(name => name != "letterSpacing").ToArray());
            fields["properties"]!["letterSpacing"]!["description"] = "Omitted or null resolves to zero.";
            return Choice(flat, WithTag(fields, "typographyFields", required: true));
        }
        var tag = type switch
        {
            TokenType.Spacing => "spacing", TokenType.Geometry => "geometry",
            TokenType.Dimension => "dimension", TokenType.Number => "number",
            TokenType.FontFamily => "fontFamily", TokenType.FontWeight => "fontWeight",
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };
        return TaggedScalar(CompactTokenLiteral(type, category), tag, type == TokenType.Geometry ? "radius" : "value");
    }

    private static JsonObject AliasExpressionSchema(TokenType type, TokenCategory? category)
    {
        var schema = WithTag(ReferenceSchema<McpTokenReferenceInput>(), "alias", required: true, field: "expression");
        schema["description"] = $"Existing {type} token, category {category?.ToString() ?? "none"}; resolves in the same theme; no alias cycles.";
        return schema;
    }

    private static JsonObject LiteralExpressionSchema(TokenType type, TokenCategory? category = null) =>
        WithTag(ObjectSchema(new JsonObject { ["value"] = CanonicalTokenLiteral(type, category) }, "value"),
            "literal", required: true, field: "expression");

    private static JsonObject TokenExpressionSchema(TokenType type, TokenCategory? category = null) =>
        Choice(AliasExpressionSchema(type, category), LiteralExpressionSchema(type, category));

    internal static JsonObject TokenInputSchema(TokenType type, TokenCategory? category = null)
    {
        var alternatives = new List<JsonObject>();
        if (type == TokenType.Color) alternatives.AddRange([HexSchema(), RgbaSchema()]);
        else alternatives.Add(CompactTokenLiteral(type, category));
        var reference = ReferenceSchema<McpTokenReferenceInput>();
        reference["description"] = $"Existing {type} token of the same category; resolves in the same theme; no alias cycles.";
        alternatives.AddRange([reference, AliasExpressionSchema(type, category), LiteralExpressionSchema(type, category)]);
        return Choice(alternatives.ToArray());
    }

    internal static JsonObject LegacySpacingCreateSchema()
    {
        // The existing create_token shortcut normalizes two noncanonical inputs to Dimension/Spacing.
        return Choice(CompactTokenLiteral(TokenType.Dimension, TokenCategory.Spacing), ReferenceSchema<McpTokenReferenceInput>());
    }

    internal static JsonObject CompactLiteralSchema(NodePropertyDefinition definition) => definition.Type switch
    {
        NodePropertyType.Color => ColorSchema(),
        NodePropertyType.Shadow => ShadowSchema(),
        NodePropertyType.LinearGradient => WithTag(Schema<NodeLinearGradientValue>(), "linearGradient"),
        _ => throw new ArgumentOutOfRangeException(nameof(definition))
    };

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
        NodePropertyType.LinearGradient => WithTag(Schema<NodeLinearGradientValue>(), "linearGradient"),
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
            definition.Type is NodePropertyType.Number or NodePropertyType.Color or NodePropertyType.String or NodePropertyType.Enum or NodePropertyType.Shadow)
            alternatives.Add(ReferenceSchema<McpTokenReferenceInput>("token"));

        return alternatives.Count == 1
            ? (JsonObject)literal.DeepClone()
            : new JsonObject { ["anyOf"] = alternatives };
    }
}
