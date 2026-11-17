using System.Text.Json.Serialization;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Documents;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(NodeStringValue), "string")]
[JsonDerivedType(typeof(NodeNumberValue), "number")]
[JsonDerivedType(typeof(NodeBooleanValue), "boolean")]
[JsonDerivedType(typeof(NodeAssetValue), "asset")]
[JsonDerivedType(typeof(NodeTokenValue), "token")]
[JsonDerivedType(typeof(NodeEnumValue), "enum")]
public abstract record NodePropertyValue;
public sealed record NodeStringValue(string Value) : NodePropertyValue;
public sealed record NodeNumberValue(double Value) : NodePropertyValue;
public sealed record NodeBooleanValue(bool Value) : NodePropertyValue;
public sealed record NodeAssetValue(Guid AssetId) : NodePropertyValue;
public sealed record NodeTokenValue(Guid TokenId) : NodePropertyValue;
public sealed record NodeEnumValue(string Value) : NodePropertyValue;
public enum NodePropertyType { String, Number, Boolean, Asset, TokenReference, Enum }

// The profile supplies target-specific restrictions and their diagnostic reasons.
public sealed record NodePropertyDefinition(NodePropertyType Type, Func<NodePropertyValue, string?>? ValidateValue = null,
    TokenType? TokenType = null, IReadOnlyList<string>? EnumValues = null);
public sealed record NodePropertyError(string Code, string Reason);

public static class NodePropertyValidator
{
    public static NodePropertyError? Validate(INodeProfile profile, string kind, string property, NodePropertyValue? value)
    {
        var definition = string.IsNullOrWhiteSpace(property) ? null : profile.GetProperty(kind, property);
        if (definition is null) return new("UNSUPPORTED_PROPERTY", $"Property '{property}' is not supported for '{kind}' by this profile.");
        var matches = (definition.Type, value) switch
        {
            (NodePropertyType.String, NodeStringValue) => true,
            (NodePropertyType.Number, NodeNumberValue) => true,
            (NodePropertyType.Boolean, NodeBooleanValue) => true,
            (NodePropertyType.Asset, NodeAssetValue) => true,
            (NodePropertyType.TokenReference, NodeTokenValue) => true,
            (NodePropertyType.Enum, NodeEnumValue) => true,
            _ => false
        };
        if (!matches) return new("INVALID_PROPERTY_TYPE", $"Property '{property}' requires {definition.Type}.");
        if (value is NodeEnumValue item && definition.EnumValues?.Contains(item.Value) != true)
            return new("INVALID_PROPERTY_VALUE", $"Property '{property}' requires a declared enum value.");
        if (value is NodeNumberValue number && !double.IsFinite(number.Value) || value is NodeStringValue { Value: null })
            return new("INVALID_PROPERTY_VALUE", "Property values must contain a non-null string or a finite number.");
        if (value is NodeAssetValue { AssetId: var asset } && asset == Guid.Empty ||
            value is NodeTokenValue { TokenId: var token } && token == Guid.Empty)
            return new("INVALID_PROPERTY_VALUE", "Reference IDs must be nonempty.");
        return definition.ValidateValue?.Invoke(value!) is { } reason ? new("INVALID_PROPERTY_VALUE", reason) : null;
    }
}
