using System.Globalization;
using System.Text.Json;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

public sealed class McpContractException(string code, string message,
    string? property = null, string? expected = null, string? actual = null) : Exception(message)
{
    public string Code { get; } = code;
    public string? Property { get; } = property;
    public string? Expected { get; } = expected;
    public string? Actual { get; } = actual;
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
                throw new McpContractException("UNSUPPORTED_PROPERTY", $"Property '{McpPropertyDiagnostics.SafePath(name)}' is not supported by node kind '{kind}'.",
                    McpPropertyDiagnostics.SafePath(name), $"A property supported by {kind}");
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
            catch (Exception e) when (e is InvalidOperationException or FormatException or KeyNotFoundException or JsonException)
            {
                throw McpPropertyDiagnostics.Explain("INVALID_PROPERTY_TYPE", name, value,
                    McpPropertyContracts.InputSchema(definition), e as JsonException);
            }
            if (NodePropertyValidator.Validate(profile, kind, name, converted) is { } invalid)
                throw McpPropertyDiagnostics.Explain(invalid.Code, name, value,
                    McpPropertyContracts.InputSchema(definition), domainReason: invalid.Reason);
            result.Add(name, converted);
        }
        return result;
    }

    private static Guid? Reference(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out _)) return null;
        return name switch
        {
            "tokenId" => McpPropertyContracts.Read<McpTokenReferenceInput>(value).TokenId,
            "assetId" => McpPropertyContracts.Read<McpAssetReferenceInput>(value).AssetId,
            "styleId" => McpPropertyContracts.Read<McpStyleReferenceInput>(value).StyleId,
            _ => throw new ArgumentOutOfRangeException(nameof(name))
        };
    }

    public static NodeColorValue Color(JsonElement value) => Color(value.GetString());

    private static NodeColorValue Color(string? text)
    {
        if (text is null || text.Length is not (7 or 9) ||
            !System.Text.RegularExpressions.Regex.IsMatch(text, McpPropertyContracts.ColorPattern))
            throw new FormatException("Expected a #RRGGBB or #RRGGBBAA color.");
        byte Part(int offset) => byte.Parse(text.AsSpan(offset, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
        return new(Part(1), Part(3), Part(5), text.Length == 9 ? Part(7) : (byte)255);
    }

    private static NodeShadowValue Shadow(JsonElement value)
    {
        var input = McpPropertyContracts.Read<McpShadowInput>(value);
        return new(input.OffsetX, input.OffsetY, input.BlurRadius, input.SpreadRadius, Color(input.Color));
    }

    private static TypographyValue Typography(JsonElement value)
    {
        var input = McpPropertyContracts.Read<McpTypographyInput>(value);
        return new(input.FontFamily, input.FontSize, input.FontWeight, input.LineHeight, input.LetterSpacing);
    }

    public static TokenExpression Token(TokenType type, JsonElement value, string property = "value")
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
                TokenType.Typography => Typography(value),
                _ => throw new FormatException()
            };
            return new LiteralTokenValue(literal);
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or KeyNotFoundException or JsonException)
        {
            throw McpPropertyDiagnostics.Explain("INVALID_TOKEN", property, value,
                McpPropertyContracts.TokenInputSchema(type), e as JsonException);
        }
    }

    private static ColorValue ToTokenColor(NodeColorValue color) => new(color.Red, color.Green, color.Blue, color.Alpha);
}
