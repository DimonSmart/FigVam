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
[JsonDerivedType(typeof(NodeStyleValue), "style")]
[JsonDerivedType(typeof(NodeTypographyValue), "typography")]
[JsonDerivedType(typeof(NodeEnumValue), "enum")]
[JsonDerivedType(typeof(NodeColorValue), "color")]
[JsonDerivedType(typeof(NodeShadowValue), "shadow")]
public abstract record NodePropertyValue;
public sealed record NodeStringValue(string Value) : NodePropertyValue;
public sealed record NodeNumberValue(double Value) : NodePropertyValue;
public sealed record NodeBooleanValue(bool Value) : NodePropertyValue;
public sealed record NodeAssetValue(Guid AssetId) : NodePropertyValue;
public sealed record NodeTokenValue(Guid TokenId) : NodePropertyValue;
public sealed record NodeStyleValue(Guid StyleId) : NodePropertyValue;
public sealed record NodeTypographyValue(TokenValue Value) : NodePropertyValue;
public sealed record NodeEnumValue(string Value) : NodePropertyValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record NodeColorValue([property: JsonRequired] byte Red, [property: JsonRequired] byte Green,
    [property: JsonRequired] byte Blue, byte Alpha = 255) : NodePropertyValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record NodeShadowValue(
    [property: JsonRequired] double OffsetX,
    [property: JsonRequired] double OffsetY,
    [property: JsonRequired] double BlurRadius,
    [property: JsonRequired] double SpreadRadius,
    [property: JsonRequired] NodeColorValue Color) : NodePropertyValue
{
    public const double MaxOffset = 1024;
    public const double MaxBlurRadius = 256;
    public const double MaxSpreadRadius = 256;
}
public enum NodePropertyType { String, Number, Boolean, Asset, TokenReference, Enum, Color, StyleReference, Shadow }

// The profile supplies target-specific restrictions and their diagnostic reasons.
public sealed record NodePropertyDefinition(
    [property: JsonConverter(typeof(JsonStringEnumConverter<NodePropertyType>))] NodePropertyType Type,
    [property: JsonIgnore] Func<NodePropertyValue, string?>? ValidateValue = null,
    TokenType? TokenType = null, IReadOnlyList<string>? EnumValues = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TokenCategory? TokenCategory = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TokenType? LegacyTokenType = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool NumericFontWeight = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DesignStyleType? StyleType = null)
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
            (NodePropertyType.StyleReference, NodeStyleValue) => true,
            (NodePropertyType.Enum, NodeEnumValue) => true,
            (NodePropertyType.Color, NodeColorValue) => true,
            (NodePropertyType.Shadow, NodeShadowValue) => true,
            (NodePropertyType.Number or NodePropertyType.Color or NodePropertyType.String or NodePropertyType.Enum or NodePropertyType.Shadow, NodeTokenValue)
                => definition.TokenType is not null,
            (NodePropertyType.Enum, NodeNumberValue) => definition.NumericFontWeight,
            _ => false
        };
        if (!matches)
        {
            var expected = definition.TokenType is { } tokenType && definition.Type != NodePropertyType.TokenReference
                ? $"{definition.Type} or a {tokenType} token" : definition.Type.ToString();
            return new("INVALID_PROPERTY_TYPE", $"Property '{property}' requires {expected}.");
        }
        if (value is NodeShadowValue shadow && !IsValidShadow(shadow))
            return new("INVALID_PROPERTY_VALUE", "Shadow requires finite offsets in [-1024, 1024], blur in [0, 256], spread in [-256, 256] and a color.");
        if (value is NodeEnumValue item && definition.EnumValues?.Contains(item.Value) != true)
            return new("INVALID_PROPERTY_VALUE", $"Property '{property}' requires a declared enum value.");
        if (value is NodeNumberValue { Value: var weight } && definition.NumericFontWeight &&
            (weight != Math.Truncate(weight) || weight < 1 || weight > 1000))
            return new("INVALID_PROPERTY_VALUE", "Numeric font weight must be an integer from 1 to 1000.");
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
            value is NodeTokenValue { TokenId: var token } && token == Guid.Empty ||
            value is NodeStyleValue { StyleId: var style } && style == Guid.Empty)
            return new("INVALID_PROPERTY_VALUE", "Reference IDs must be nonempty.");
        // Custom literal validators operate on the resolved value, not on its token ID.
        if (value is NodeTokenValue && definition.Type != NodePropertyType.TokenReference)
            return null;
        return definition.ValidateValue?.Invoke(value!) is { } reason ? new("INVALID_PROPERTY_VALUE", reason) : null;
    }

    public static bool IsValidShadow(NodeShadowValue shadow) =>
        InRange(shadow.OffsetX, -NodeShadowValue.MaxOffset, NodeShadowValue.MaxOffset) &&
        InRange(shadow.OffsetY, -NodeShadowValue.MaxOffset, NodeShadowValue.MaxOffset) &&
        InRange(shadow.BlurRadius, 0, NodeShadowValue.MaxBlurRadius) &&
        InRange(shadow.SpreadRadius, -NodeShadowValue.MaxSpreadRadius, NodeShadowValue.MaxSpreadRadius) &&
        shadow.Color is not null;

    private static bool InRange(double value, double min, double max) => double.IsFinite(value) && value >= min && value <= max;

    // Shared conversion for layout, variants, and component-bound properties.
    internal static (NodePropertyValue? Value, NodePropertyError? Error) ResolveValueToken(
        DesignTokenResolver tokens, NodePropertyDefinition definition, string property, NodeTokenValue reference, TokenTheme theme)
    {
        if (CheckTokenReference(tokens, definition, reference) is { } referenceError)
            return (null, referenceError);
        var result = tokens.Resolve(reference.TokenId, theme);
        if (result.Diagnostics.FirstOrDefault() is { } diagnostic)
            return (null, new(diagnostic.Code, $"{theme}: {diagnostic.Message}"));
        NodePropertyValue? value = result.Value switch
        {
            SpacingValue spacing => new NodeNumberValue(spacing.Value),
            GeometryValue geometry => new NodeNumberValue(geometry.Radius),
            DimensionValue dimension => new NodeNumberValue(dimension.Value),
            NumberValue number => new NodeNumberValue(number.Value),
            FontWeightValue weight => new NodeNumberValue(weight.Value),
            FontFamilyValue family => new NodeStringValue(family.Value),
            ColorValue color => new NodeColorValue(color.Red, color.Green, color.Blue, color.Alpha),
            ShadowValue shadow => shadow.ToNodeValue(),
            _ => null
        };
        if (value is null) return (null, new("type-mismatch", "Token value is not compatible with the property."));
        return Validate(definition, property, value) is { } error
            ? (null, error with { Reason = $"{theme}: {error.Reason}" }) : (value, null);
    }

    internal static (NodeNumberValue? Value, NodePropertyError? Error) ResolveNumberToken(
        DesignTokenResolver tokens, NodePropertyDefinition definition, string property, NodeTokenValue reference, TokenTheme theme)
    {
        var (value, error) = ResolveValueToken(tokens, definition, property, reference, theme);
        return (value as NodeNumberValue, error ?? (value is NodeNumberValue ? null :
            new NodePropertyError("type-mismatch", "Token does not resolve to a number.")));
    }

    internal static (string Code, Guid Id, string Reason)? ValidateTokenReference(
        DesignTokenResolver tokens, NodePropertyDefinition? definition, string property, NodeTokenValue reference,
        TokenTheme? theme = null)
    {
        if (CheckTokenReference(tokens, definition, reference) is { } error)
            return (error.Code, reference.TokenId, error.Reason);
        if (definition is null) return ("type-mismatch", reference.TokenId, "Token is not allowed for this property.");
        // Standalone TokenReference contracts may be backed by placeholder catalog entries.
        // Their type/category is validated above; the token definition is validated by the
        // complete document validator once its themed values are available.
        if (definition.Type == NodePropertyType.TokenReference) return null;
        foreach (var applicable in theme is { } selected ? [selected] : Enum.GetValues<TokenTheme>())
            if (ResolveValueToken(tokens, definition, property, reference, applicable).Error is { } invalid)
                return (invalid.Code, reference.TokenId, invalid.Reason);
        return null;
    }

    internal static bool AcceptsToken(NodePropertyDefinition definition, DesignToken token) =>
        definition.TokenType == token.Type && definition.TokenCategory == token.Category ||
        definition.LegacyTokenType == token.Type && token.Category is null;

    private static NodePropertyError? CheckTokenReference(
        DesignTokenResolver tokens, NodePropertyDefinition? definition, NodeTokenValue reference)
    {
        if (reference.TokenId == Guid.Empty)
            return new("INVALID_PROPERTY_VALUE", "Reference IDs must be nonempty.");
        var token = tokens.Find(reference.TokenId);
        if (token is null) return new("missing-reference", "Referenced token does not exist.");
        if (definition is null || !AcceptsToken(definition, token))
            return new("type-mismatch", "Token type or semantic category does not match the property.");
        return null;
    }

    internal static (string Code, Guid Id, string Reason)? ValidateReference(
        DocumentStructure document, DesignTokenResolver tokens, NodePropertyDefinition? definition,
        string property, NodePropertyValue value, TokenTheme? theme = null)
    {
        if (value is NodeTokenValue reference)
            return ValidateTokenReference(tokens, definition, property, reference, theme);
        if (value is NodeStyleValue style)
        {
            var target = document.Styles?.FirstOrDefault(s => s.Id == style.StyleId);
            if (target is null) return ("missing-reference", style.StyleId, "Referenced design style does not exist.");
            if (definition?.Type != NodePropertyType.StyleReference || definition.StyleType != target.Type)
                return ("type-mismatch", style.StyleId, "Design style type does not match the property.");
        }
        if (value is NodeAssetValue asset && !document.Assets.Any(a => a.Id == asset.AssetId && DocumentAssetValidator.IsImageContentType(a.ContentType)))
            return ("missing-reference", asset.AssetId, "Referenced asset does not exist in this document snapshot.");
        return null;
    }
}
