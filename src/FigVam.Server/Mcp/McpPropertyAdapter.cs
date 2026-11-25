using System.Globalization;
using System.Text.Json;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

public sealed class McpContractException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public static class McpPropertyAdapter
{
    public static IReadOnlyDictionary<string, NodePropertyValue> ConvertProperties(INodeProfile profile,
        string kind, IReadOnlyDictionary<string, JsonElement> properties)
    {
        if (!profile.IsKnownKind(kind)) throw new McpContractException("UNSUPPORTED_NODE_KIND", "Unknown node kind.");
        var result = new Dictionary<string, NodePropertyValue>(StringComparer.Ordinal);
        foreach (var (name, value) in properties)
        {
            var definition = profile.GetProperty(kind, name) ??
                throw new McpContractException("UNSUPPORTED_PROPERTY", $"Property '{name}' is not supported by '{kind}'.");
            NodePropertyValue converted;
            try
            {
                converted = Reference(value, "tokenId") is { } token ? new NodeTokenValue(token) : definition.Type switch
                {
                    NodePropertyType.String => new NodeStringValue(value.GetString() ?? throw new FormatException()),
                    NodePropertyType.Number => new NodeNumberValue(value.GetDouble()),
                    NodePropertyType.Boolean => new NodeBooleanValue(value.GetBoolean()),
                    NodePropertyType.Enum when definition.NumericFontWeight && value.ValueKind == JsonValueKind.Number => new NodeNumberValue(value.GetDouble()),
                    NodePropertyType.Enum => new NodeEnumValue(value.GetString() ?? throw new FormatException()),
                    NodePropertyType.Color => Color(value),
                    NodePropertyType.Asset => new NodeAssetValue(Reference(value, "assetId") ?? throw new FormatException()),
                    NodePropertyType.StyleReference => new NodeStyleValue(Reference(value, "styleId") ?? throw new FormatException()),
                    NodePropertyType.Shadow => Shadow(value),
                    _ => throw new FormatException()
                };
            }
            catch (Exception e) when (e is InvalidOperationException or FormatException or KeyNotFoundException)
            {
                throw new McpContractException("INVALID_PROPERTY_TYPE", $"Invalid value for '{name}'.");
            }
            if (NodePropertyValidator.Validate(profile, kind, name, converted) is { } invalid)
                throw new McpContractException(invalid.Code, invalid.Reason);
            result.Add(name, converted);
        }
        return result;
    }

    private static Guid? Reference(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var id)) return null;
        if (value.EnumerateObject().Count() != 1 || !id.TryGetGuid(out var parsed)) throw new FormatException();
        return parsed;
    }

    public static NodeColorValue Color(JsonElement value)
    {
        var text = value.GetString();
        if (text is null || text.Length is not (7 or 9) || text[0] != '#') throw new FormatException();
        byte Part(int offset) => byte.Parse(text.AsSpan(offset, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
        return new(Part(1), Part(3), Part(5), text.Length == 9 ? Part(7) : (byte)255);
    }

    private static NodeShadowValue Shadow(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != 5) throw new FormatException();
        return new(value.GetProperty("offsetX").GetDouble(), value.GetProperty("offsetY").GetDouble(),
            value.GetProperty("blurRadius").GetDouble(), value.GetProperty("spreadRadius").GetDouble(),
            Color(value.GetProperty("color")));
    }

    public static TokenExpression Token(TokenType type, JsonElement value)
    {
        try
        {
            if (Reference(value, "tokenId") is { } token) return new TokenAlias(token);
            TokenValue literal = type switch
            {
                TokenType.Color => ToTokenColor(Color(value)),
                TokenType.Spacing => new SpacingValue(value.GetDouble()),
                TokenType.Geometry => new GeometryValue(value.GetDouble()),
                TokenType.Dimension => new DimensionValue(value.GetDouble()),
                TokenType.Number => new NumberValue(value.GetDouble()),
                TokenType.FontFamily => new FontFamilyValue(value.GetString() ?? throw new FormatException()),
                TokenType.FontWeight => new FontWeightValue(value.GetInt32()),
                TokenType.Typography => new TypographyValue(value.GetProperty("fontFamily").GetString()!,
                    value.GetProperty("fontSize").GetDouble(), value.GetProperty("fontWeight").GetInt32(),
                    value.GetProperty("lineHeight").GetDouble(),
                    value.TryGetProperty("letterSpacing", out var spacing) ? spacing.GetDouble() : 0),
                _ => throw new FormatException()
            };
            return new LiteralTokenValue(literal);
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or KeyNotFoundException)
        {
            throw new McpContractException("INVALID_TOKEN", "Value does not match the token type.");
        }
    }

    private static ColorValue ToTokenColor(NodeColorValue color) => new(color.Red, color.Green, color.Blue, color.Alpha);
}
