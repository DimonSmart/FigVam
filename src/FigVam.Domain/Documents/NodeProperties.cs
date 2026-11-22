using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Documents;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(NodeStringValue), "string")]
[JsonDerivedType(typeof(NodeNumberValue), "number")]
[JsonDerivedType(typeof(NodeBooleanValue), "boolean")]
[JsonDerivedType(typeof(NodeAssetValue), "asset")]
[JsonDerivedType(typeof(NodeTokenValue), "token")]
[JsonDerivedType(typeof(NodeEnumValue), "enum")]
[JsonDerivedType(typeof(NodeColorValue), "color")]
public abstract record NodePropertyValue;
public sealed record NodeStringValue(string Value) : NodePropertyValue;
public sealed record NodeNumberValue(double Value) : NodePropertyValue;
public sealed record NodeBooleanValue(bool Value) : NodePropertyValue;
public sealed record NodeAssetValue(Guid AssetId) : NodePropertyValue;
public sealed record NodeTokenValue(Guid TokenId) : NodePropertyValue;
public sealed record NodeEnumValue(string Value) : NodePropertyValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record NodeColorValue([property: JsonRequired] byte Red, [property: JsonRequired] byte Green,
    [property: JsonRequired] byte Blue, byte Alpha = 255) : NodePropertyValue;
public enum NodePropertyType { String, Number, Boolean, Asset, TokenReference, Enum, Color }

// The profile supplies target-specific restrictions and their diagnostic reasons.
public sealed record NodePropertyDefinition(
    [property: JsonConverter(typeof(JsonStringEnumConverter<NodePropertyType>))] NodePropertyType Type,
    [property: JsonIgnore] Func<NodePropertyValue, string?>? ValidateValue = null,
    TokenType? TokenType = null, IReadOnlyList<string>? EnumValues = null)
{
    public NodePropertyValue? DefaultValue { get; init; }
    public bool Required { get; init; }
    public double? Minimum { get; init; }
    public double? Maximum { get; init; }
    public int? MaxLength { get; init; }
    public string? Pattern { get; init; }
}
public sealed record NodePropertyError(string Code, string Reason);

public static class NodePropertyValidator
{
    public static NodePropertyError? Validate(INodeProfile profile, string kind, string property, NodePropertyValue? value)
    {
        var definition = string.IsNullOrWhiteSpace(property) ? null : profile.GetProperty(kind, property);
        if (definition is null) return new("UNSUPPORTED_PROPERTY", $"Property '{property}' is not supported for '{kind}' by this profile.");
        return Validate(definition, property, value);
    }

    private static NodePropertyError? Validate(NodePropertyDefinition definition, string property, NodePropertyValue? value)
    {
        var matches = (definition.Type, value) switch
        {
            (NodePropertyType.String, NodeStringValue) => true,
            (NodePropertyType.Number, NodeNumberValue) => true,
            (NodePropertyType.Boolean, NodeBooleanValue) => true,
            (NodePropertyType.Asset, NodeAssetValue) => true,
            (NodePropertyType.TokenReference, NodeTokenValue) => true,
            (NodePropertyType.Enum, NodeEnumValue) => true,
            (NodePropertyType.Color, NodeColorValue) => true,
            (NodePropertyType.Number, NodeTokenValue) => definition.TokenType == TokenType.Spacing,
            (NodePropertyType.Color, NodeTokenValue) => definition.TokenType == TokenType.Color,
            _ => false
        };
        if (!matches)
        {
            var expected = definition.TokenType is { } tokenType && definition.Type != NodePropertyType.TokenReference
                ? $"{definition.Type} or a {tokenType} token" : definition.Type.ToString();
            return new("INVALID_PROPERTY_TYPE", $"Property '{property}' requires {expected}.");
        }
        if (value is NodeEnumValue item && definition.EnumValues?.Contains(item.Value) != true)
            return new("INVALID_PROPERTY_VALUE", $"Property '{property}' requires a declared enum value.");
        if (value is NodeNumberValue number && !double.IsFinite(number.Value) || value is NodeStringValue { Value: null })
            return new("INVALID_PROPERTY_VALUE", "Property values must contain a non-null string or a finite number.");
        if (value is NodeNumberValue numeric && (numeric.Value < definition.Minimum || numeric.Value > definition.Maximum))
            return new("INVALID_PROPERTY_VALUE", $"Property '{property}' is out of range ({definition.Minimum} to {definition.Maximum}).");
        if (value is NodeStringValue text && text.Value.Length > definition.MaxLength)
            return new("INVALID_PROPERTY_VALUE", $"Property '{property}' is limited to {definition.MaxLength} characters.");
        if (value is NodeStringValue name && definition.Pattern is { } pattern)
        {
            var match = Regex.Match(name.Value, pattern, RegexOptions.CultureInvariant);
            if (!match.Success || match.Length != name.Value.Length)
                return new("INVALID_PROPERTY_VALUE", $"Property '{property}' must match the declared format.");
        }
        if (value is NodeAssetValue { AssetId: var asset } && asset == Guid.Empty ||
            value is NodeTokenValue { TokenId: var token } && token == Guid.Empty)
            return new("INVALID_PROPERTY_VALUE", "Reference IDs must be nonempty.");
        return definition.ValidateValue?.Invoke(value!) is { } reason ? new("INVALID_PROPERTY_VALUE", reason) : null;
    }

    internal static (NodeNumberValue? Value, NodePropertyError? Error) ResolveNumberToken(
        DesignTokenResolver tokens, NodePropertyDefinition definition, string property, NodeTokenValue reference, TokenTheme theme)
    {
        if (CheckTokenReference(tokens, definition, reference) is { } referenceError)
            return (null, referenceError);
        var result = tokens.Resolve(reference.TokenId, theme);
        if (result.Diagnostics.FirstOrDefault() is { } diagnostic)
            return (null, new(diagnostic.Code, $"{theme}: {diagnostic.Message}"));
        if (result.Value is not SpacingValue spacing)
            return (null, new("type-mismatch", "Token type does not match the property."));
        var value = new NodeNumberValue(spacing.Value);
        return Validate(definition, property, value) is { } error
            ? (null, error with { Reason = $"{theme}: {error.Reason}" }) : (value, null);
    }

    internal static (string Code, Guid Id, string Reason)? ValidateTokenReference(
        DesignTokenResolver tokens, NodePropertyDefinition? definition, string property, NodeTokenValue reference,
        TokenTheme? theme = null)
    {
        if (definition?.Type == NodePropertyType.Number)
        {
            foreach (var applicable in theme is { } selected ? [selected] : Enum.GetValues<TokenTheme>())
                if (ResolveNumberToken(tokens, definition, property, reference, applicable).Error is { } invalid)
                    return (invalid.Code, reference.TokenId, invalid.Reason);
            return null;
        }
        return CheckTokenReference(tokens, definition, reference) is { } error
            ? (error.Code, reference.TokenId, error.Reason) : null;
    }

    private static NodePropertyError? CheckTokenReference(
        DesignTokenResolver tokens, NodePropertyDefinition? definition, NodeTokenValue reference)
    {
        if (reference.TokenId == Guid.Empty)
            return new("INVALID_PROPERTY_VALUE", "Reference IDs must be nonempty.");
        var token = tokens.Find(reference.TokenId);
        if (token is null) return new("missing-reference", "Referenced token does not exist.");
        if (definition?.TokenType is { } expected && token.Type != expected)
            return new("type-mismatch", "Token type does not match the property.");
        return null;
    }

    internal static (string Code, Guid Id, string Reason)? ValidateReference(
        DocumentStructure document, DesignTokenResolver tokens, NodePropertyDefinition? definition,
        string property, NodePropertyValue value, TokenTheme? theme = null)
    {
        if (value is NodeTokenValue reference)
            return ValidateTokenReference(tokens, definition, property, reference, theme);
        if (value is NodeAssetValue asset && !document.Assets.Any(a => a.Id == asset.AssetId))
            return ("missing-reference", asset.AssetId, "Referenced asset does not exist in this document snapshot.");
        return null;
    }
}
