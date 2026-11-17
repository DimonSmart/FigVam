using System.Text.Json.Serialization;

namespace FigVam.Domain.Tokens;

public enum TokenType { Color, Spacing, Typography, Geometry }
public enum TokenTheme { Light, Dark }

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ColorValue), "color")]
[JsonDerivedType(typeof(SpacingValue), "spacing")]
[JsonDerivedType(typeof(TypographyValue), "typography")]
[JsonDerivedType(typeof(GeometryValue), "geometry")]
public abstract record TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ColorValue([property: JsonRequired] byte Red, [property: JsonRequired] byte Green, [property: JsonRequired] byte Blue, byte Alpha = 255) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SpacingValue([property: JsonRequired] double Value) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TypographyValue([property: JsonRequired] string FontFamily, [property: JsonRequired] double FontSize, [property: JsonRequired] int FontWeight, [property: JsonRequired] double LineHeight) : TokenValue;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record GeometryValue([property: JsonRequired] double Radius) : TokenValue;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "expression")]
[JsonDerivedType(typeof(LiteralTokenValue), "literal")]
[JsonDerivedType(typeof(TokenAlias), "alias")]
public abstract record TokenExpression;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LiteralTokenValue([property: JsonRequired] TokenValue Value) : TokenExpression;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TokenAlias([property: JsonRequired] Guid TokenId) : TokenExpression;

public sealed record DesignToken(Guid Id, string Name, TokenType Type,
    IReadOnlyDictionary<TokenTheme, TokenExpression> Values);
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
            else if (expression is LiteralTokenValue literal && !Matches(token.Type, literal.Value))
                errors.Add(new("type-mismatch", token.Id, theme, null, "Literal value does not match token type."));
            else if (expression is TokenAlias alias)
            {
                if (!byId.TryGetValue(alias.TokenId, out var target))
                    errors.Add(new("missing-reference", token.Id, theme, alias.TokenId, "Alias target does not exist."));
                else if (target.Type != token.Type)
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
                        !byId.TryGetValue(alias.TokenId, out var target) || target.Type != current.Type)
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
        var byId = tokens.ToDictionary(t => t.Id);
        if (!byId.TryGetValue(tokenId, out var token))
            return new(null, [new("missing-reference", tokenId, theme, tokenId, "Token does not exist.")]);
        if (!Enum.IsDefined(theme))
            return new(null, [new("incomplete-theme", tokenId, theme, null, "Unknown theme.")]);
        while (token.Values[theme] is TokenAlias alias) token = byId[alias.TokenId];
        return new(((LiteralTokenValue)token.Values[theme]).Value, []);
    }

    private static bool Matches(TokenType type, TokenValue? value) => (type, value) switch
    {
        (TokenType.Color, ColorValue) => true,
        (TokenType.Spacing, SpacingValue spacing) => double.IsFinite(spacing.Value),
        (TokenType.Geometry, GeometryValue geometry) => double.IsFinite(geometry.Radius) && geometry.Radius >= 0,
        (TokenType.Typography, TypographyValue typography) => !string.IsNullOrWhiteSpace(typography.FontFamily) &&
            typography.FontFamily.Length <= 256 && double.IsFinite(typography.FontSize) && typography.FontSize > 0 &&
            typography.FontWeight is >= 1 and <= 1000 && double.IsFinite(typography.LineHeight) && typography.LineHeight > 0,
        _ => false
    };
}
