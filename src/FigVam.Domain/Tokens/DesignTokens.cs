using System.Text.Json.Serialization;

namespace FigVam.Domain.Tokens;

// Explicit numbers preserve the wire values of documents created before v4.
public enum TokenType { Color = 0, Spacing = 1, Typography = 2, Geometry = 3,
    Dimension = 4, Number = 5, FontFamily = 6, FontWeight = 7 }
public enum TokenCategory { Spacing, FontSize, Radius, BorderWidth, Size, LineHeight, Opacity }
public enum TokenTheme { Light, Dark }

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ColorValue), "color")]
[JsonDerivedType(typeof(SpacingValue), "spacing")]
[JsonDerivedType(typeof(TypographyValue), "typography")]
[JsonDerivedType(typeof(GeometryValue), "geometry")]
[JsonDerivedType(typeof(DimensionValue), "dimension")]
[JsonDerivedType(typeof(NumberValue), "number")]
[JsonDerivedType(typeof(FontFamilyValue), "fontFamily")]
[JsonDerivedType(typeof(FontWeightValue), "fontWeight")]
public abstract record TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ColorValue([property: JsonRequired] byte Red, [property: JsonRequired] byte Green, [property: JsonRequired] byte Blue, byte Alpha = 255) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SpacingValue([property: JsonRequired] double Value) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TypographyValue([property: JsonRequired] string FontFamily, [property: JsonRequired] double FontSize, [property: JsonRequired] int FontWeight, [property: JsonRequired] double LineHeight) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record GeometryValue([property: JsonRequired] double Radius) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DimensionValue([property: JsonRequired] double Value) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record NumberValue([property: JsonRequired] double Value) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FontFamilyValue([property: JsonRequired] string Value) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FontWeightValue([property: JsonRequired] int Value) : TokenValue;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "expression")]
[JsonDerivedType(typeof(LiteralTokenValue), "literal")]
[JsonDerivedType(typeof(TokenAlias), "alias")]
public abstract record TokenExpression;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LiteralTokenValue([property: JsonRequired] TokenValue Value) : TokenExpression;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TokenAlias([property: JsonRequired] Guid TokenId) : TokenExpression;

public sealed record DesignToken(Guid Id, string Name, TokenType Type,
    IReadOnlyDictionary<TokenTheme, TokenExpression> Values, TokenCategory? Category = null);
public sealed record TokenDiagnostic(string Code, Guid TokenId, TokenTheme? Theme, Guid? ReferenceId, string Message);
public sealed record TokenResolution(TokenValue? Value, IReadOnlyList<TokenDiagnostic> Diagnostics)
{
    public bool IsSuccess => Diagnostics.Count == 0;
}

public static class DesignTokenValidator
{
    public static bool IsValidName(string? name) => !string.IsNullOrWhiteSpace(name) && name.Length <= 256 && !name.Any(char.IsControl);

    public static IReadOnlyList<TokenDiagnostic> Validate(IReadOnlyList<DesignToken> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        var errors = new List<TokenDiagnostic>();
        if (tokens.Any(t => t is null)) return [new("invalid-token", Guid.Empty, null, null, "Token entries cannot be null.")];
        var byId = new Dictionary<Guid, DesignToken>();
        foreach (var token in tokens)
        {
            if (!IsValidName(token.Name))
                errors.Add(new("invalid-name", token.Id, null, null, "Token name must contain 1 to 256 printable characters."));
            if (!Enum.IsDefined(token.Type))
                errors.Add(new("invalid-type", token.Id, null, null, "Unknown token type."));
            if (!ValidCategory(token.Type, token.Category))
                errors.Add(new("invalid-category", token.Id, null, null, "Token category does not match its type."));
            if (token.Values is null || token.Values.Keys.Any(k => !Enum.IsDefined(k)))
                errors.Add(new("invalid-theme", token.Id, null, null, "Unknown or missing theme collection."));
            if (token.Id == Guid.Empty)
                errors.Add(new("empty-id", token.Id, null, null, "Token must have a nonempty ID."));
            if (!byId.TryAdd(token.Id, token))
                errors.Add(new("duplicate-id", token.Id, null, null, "Token ID must be unique."));
        }
        foreach (var token in tokens)
        foreach (var theme in Enum.GetValues<TokenTheme>())
        {
            if (token.Values is null || !token.Values.TryGetValue(theme, out var expression) || expression is null)
                errors.Add(new("incomplete-theme", token.Id, theme, null, "Token has no value for this theme."));
            else if (expression is LiteralTokenValue literal && !Matches(token, literal.Value))
                errors.Add(new("type-mismatch", token.Id, theme, null, "Literal value does not match token type."));
            else if (expression is TokenAlias alias)
            {
                if (!byId.TryGetValue(alias.TokenId, out var target))
                    errors.Add(new("missing-reference", token.Id, theme, alias.TokenId, "Alias target does not exist."));
                else if (!Compatible(token, target))
                    errors.Add(new("type-mismatch", token.Id, theme, alias.TokenId, "Alias target has a different type."));
            }
            else if (expression is not LiteralTokenValue)
                errors.Add(new("invalid-expression", token.Id, theme, null, "Unknown token expression."));
        }

        foreach (var theme in Enum.GetValues<TokenTheme>())
        {
            var finished = new HashSet<Guid>();
            foreach (var token in byId.Values)
            {
                var path = new HashSet<Guid>();
                var current = token;
                while (!finished.Contains(current.Id) && path.Add(current.Id))
                {
                    if (current.Values is null || !current.Values.TryGetValue(theme, out var expression) || expression is not TokenAlias alias ||
                        !byId.TryGetValue(alias.TokenId, out var target) || !Compatible(current, target))
                        break;
                    current = target;
                }
                if (path.Contains(current.Id) && !finished.Contains(current.Id) &&
                    current.Values is not null && current.Values.TryGetValue(theme, out var next) && next is TokenAlias cycleAlias && path.Contains(cycleAlias.TokenId))
                    errors.Add(new("alias-cycle", current.Id, theme, cycleAlias.TokenId, "Aliases form a cycle."));
                finished.UnionWith(path);
            }
        }
        return errors;
    }

    public static TokenResolution Resolve(IReadOnlyList<DesignToken> tokens, Guid tokenId, TokenTheme theme)
    {
        var errors = Validate(tokens);
        if (errors.Count != 0) return new(null, errors);
        return new DesignTokenResolver(tokens).Resolve(tokenId, theme);
    }

    public static bool Compatible(DesignToken left, DesignToken right) =>
        left.Type == right.Type && left.Category == right.Category;

    public static bool ValidCategory(TokenType type, TokenCategory? category) => type switch
    {
        TokenType.Dimension => category is TokenCategory.Spacing or TokenCategory.FontSize or
            TokenCategory.Radius or TokenCategory.BorderWidth or TokenCategory.Size,
        TokenType.Number => category is TokenCategory.LineHeight or TokenCategory.Opacity,
        _ => category is null
    };

    internal static bool Matches(DesignToken token, TokenValue? value)
    {
        if (!ValidCategory(token.Type, token.Category) || !Matches(token.Type, value)) return false;
        return (token.Type, token.Category, value) switch
        {
            (TokenType.Dimension, TokenCategory.FontSize, DimensionValue v) => v.Value is >= 1 and <= 1024,
            (TokenType.Dimension, _, DimensionValue v) => v.Value is >= 0 and <= 1_000_000,
            (TokenType.Number, TokenCategory.LineHeight, NumberValue v) => v.Value is >= 0.1 and <= 10,
            (TokenType.Number, TokenCategory.Opacity, NumberValue v) => v.Value is >= 0 and <= 1,
            _ => true
        };
    }

    internal static bool Matches(TokenType type, TokenValue? value) => (type, value) switch
    {
        (TokenType.Color, ColorValue) => true,
        (TokenType.Spacing, SpacingValue spacing) => double.IsFinite(spacing.Value),
        (TokenType.Geometry, GeometryValue geometry) => double.IsFinite(geometry.Radius) && geometry.Radius >= 0,
        (TokenType.Dimension, DimensionValue dimension) => double.IsFinite(dimension.Value),
        (TokenType.Number, NumberValue number) => double.IsFinite(number.Value),
        (TokenType.FontFamily, FontFamilyValue family) => family.Value is { Length: > 0 and <= 128 } &&
            System.Text.RegularExpressions.Regex.IsMatch(family.Value, @"^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$", System.Text.RegularExpressions.RegexOptions.CultureInvariant),
        (TokenType.FontWeight, FontWeightValue weight) => weight.Value is >= 1 and <= 1000,
        (TokenType.Typography, TypographyValue typography) => !string.IsNullOrWhiteSpace(typography.FontFamily) &&
            typography.FontFamily.Length <= 256 && double.IsFinite(typography.FontSize) && typography.FontSize > 0 &&
            typography.FontWeight is >= 1 and <= 1000 && double.IsFinite(typography.LineHeight) && typography.LineHeight > 0,
        _ => false
    };
}

internal sealed class DesignTokenResolver(IReadOnlyList<DesignToken> tokens)
{
    private readonly ILookup<Guid, DesignToken> byId = tokens.ToLookup(token => token.Id);
    private readonly Dictionary<(Guid, TokenTheme), TokenResolution> resolved = [];

    public DesignToken? Find(Guid id) => byId[id].FirstOrDefault();

    public TokenResolution Resolve(Guid id, TokenTheme theme)
    {
        if (resolved.TryGetValue((id, theme), out var result)) return result;
        if (Find(id) is not { } token)
            return Error("missing-reference", id, "Token does not exist.");
        if (!Enum.IsDefined(theme))
            return Error("incomplete-theme", null, "Unknown theme.");
        var path = new HashSet<Guid>();
        while (path.Add(token.Id))
        {
            if (resolved.TryGetValue((token.Id, theme), out result) && result.IsSuccess)
                return Complete(result);
            if (token.Values is null || !token.Values.TryGetValue(theme, out var expression) || expression is null)
                return Error("incomplete-theme", token.Id, "Token has no value for this theme.");
            if (expression is LiteralTokenValue literal)
                return DesignTokenValidator.Matches(token, literal.Value)
                    ? Complete(new(literal.Value, [])) : Error("type-mismatch", token.Id, "Literal value does not match token type.");
            if (expression is not TokenAlias alias)
                return Error("invalid-expression", token.Id, "Unknown token expression.");
            if (Find(alias.TokenId) is not { } target)
                return Error("missing-reference", alias.TokenId, "Alias target does not exist.");
            if (!DesignTokenValidator.Compatible(token, target))
                return Error("type-mismatch", alias.TokenId, "Alias target has a different type.");
            token = target;
        }
        return Error("alias-cycle", token.Id, "Aliases form a cycle.");

        TokenResolution Complete(TokenResolution resolution)
        {
            foreach (var item in path)
                resolved[(item, theme)] = resolution;
            return resolution;
        }

        TokenResolution Error(string code, Guid? reference, string message) =>
            resolved[(id, theme)] = new(null, [new(code, id, theme, reference, message)]);
    }
}
