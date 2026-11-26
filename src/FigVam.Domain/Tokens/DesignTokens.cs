using System.Text.Json.Serialization;

namespace FigVam.Domain.Tokens;

// Explicit numbers preserve the wire values of documents created before v4.
public enum TokenType { Color = 0, Spacing = 1, Typography = 2, Geometry = 3,
    Dimension = 4, Number = 5, FontFamily = 6, FontWeight = 7 }
public enum TokenCategory { Spacing, FontSize, Radius, BorderWidth, Size, LineHeight, Opacity, LetterSpacing }
public enum TokenTheme { Light, Dark }

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ColorValue), "color")]
[JsonDerivedType(typeof(SpacingValue), "spacing")]
[JsonDerivedType(typeof(TypographyValue), "typography")]
[JsonDerivedType(typeof(TypographyFieldsValue), "typographyFields")]
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
public sealed record TypographyValue([property: JsonRequired] string FontFamily, [property: JsonRequired] double FontSize, [property: JsonRequired] int FontWeight, [property: JsonRequired] double LineHeight, double LetterSpacing = 0) : TokenValue;
// Each field reuses the atomic token expression contract. Legacy flat TypographyValue remains supported.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TypographyFieldsValue(
    [property: JsonRequired] TokenExpression FontFamily,
    [property: JsonRequired] TokenExpression FontSize,
    [property: JsonRequired] TokenExpression FontWeight,
    [property: JsonRequired] TokenExpression LineHeight,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TokenExpression? LetterSpacing = null) : TokenValue;
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
    IReadOnlyDictionary<TokenTheme, TokenExpression> Values,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TokenCategory? Category = null);
public sealed record TokenDiagnostic(string Code, Guid TokenId, TokenTheme? Theme, Guid? ReferenceId, string Message, string? Field = null)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Expected { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Actual { get; init; }
}
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
            else if (expression is LiteralTokenValue literal)
            {
                if (literal.Value is TypographyFieldsValue fields && token.Type == TokenType.Typography)
                    ValidateTypographyFields(token, theme, fields, byId, errors);
                else if (LiteralIssue(token, literal.Value) is { } issue)
                    errors.Add(new("type-mismatch", token.Id, theme, null, issue.Message, issue.Field)
                        { Expected = issue.Expected, Actual = issue.Actual });
            }
            else if (expression is TokenAlias alias)
            {
                if (!byId.TryGetValue(alias.TokenId, out var target))
                    errors.Add(new("missing-reference", token.Id, theme, alias.TokenId, "Alias target does not exist.")
                        { Expected = "Existing token", Actual = "Missing token" });
                else if (!Compatible(token, target))
                    errors.Add(new("type-mismatch", token.Id, theme, alias.TokenId, "Alias target has a different type.")
                        { Expected = $"Compatible {token.Type} token", Actual = $"Incompatible {target.Type} token" });
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

    // Field reference compatibility belongs to the domain model, not the MCP adapter.
    public static IReadOnlyDictionary<string, (TokenType Type, TokenCategory? Category)> TypographyFieldTypes { get; } =
        new System.Collections.ObjectModel.ReadOnlyDictionary<string, (TokenType, TokenCategory?)>(
            new Dictionary<string, (TokenType, TokenCategory?)>
            {
                ["fontFamily"] = (TokenType.FontFamily, null),
                ["fontSize"] = (TokenType.Dimension, TokenCategory.FontSize),
                ["fontWeight"] = (TokenType.FontWeight, null),
                ["lineHeight"] = (TokenType.Number, TokenCategory.LineHeight),
                ["letterSpacing"] = (TokenType.Dimension, TokenCategory.LetterSpacing)
            });

    private static void ValidateTypographyFields(DesignToken owner, TokenTheme theme, TypographyFieldsValue value,
        IReadOnlyDictionary<Guid, DesignToken> byId, List<TokenDiagnostic> diagnostics)
    {
        void Check(string field, TokenExpression expression)
        {
            var (type, category) = TypographyFieldTypes[field];
            void Error(string code, Guid? reference, string reason) =>
                diagnostics.Add(new(code, owner.Id, theme, reference, $"{owner.Name}.{field}: {reason}", field));
            if (expression is LiteralTokenValue literal)
            {
                var contract = new DesignToken(owner.Id, owner.Name, type, new Dictionary<TokenTheme, TokenExpression>(), category);
                if (!Matches(contract, literal.Value)) Error("type-mismatch", null, "Literal violates the atomic field contract.");
            }
            else if (expression is TokenAlias alias)
            {
                if (!byId.TryGetValue(alias.TokenId, out var target)) Error("missing-reference", alias.TokenId, "Referenced atomic token does not exist.");
                else if (target.Type != type || target.Category != category)
                    Error("type-mismatch", alias.TokenId, "Referenced token has an incompatible type or semantic category.");
            }
            else Error("invalid-expression", null, "Field requires a literal or token reference.");
        }
        Check("fontFamily", value.FontFamily);
        Check("fontSize", value.FontSize);
        Check("fontWeight", value.FontWeight);
        Check("lineHeight", value.LineHeight);
        Check("letterSpacing", value.LetterSpacing ?? new LiteralTokenValue(new DimensionValue(0)));
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
            TokenCategory.Radius or TokenCategory.BorderWidth or TokenCategory.Size or TokenCategory.LetterSpacing,
        TokenType.Number => category is TokenCategory.LineHeight or TokenCategory.Opacity,
        _ => category is null
    };

    internal static bool Matches(DesignToken token, TokenValue? value) => LiteralIssue(token, value) is null;

    internal static bool Matches(TokenType type, TokenValue? value) => LiteralIssue(type, value) is null;

    // Both the boolean domain checks and detailed diagnostics use these same constraints.
    private sealed record ValueIssue(string? Field, string Message, string Expected, string Actual);

    private static ValueIssue? NumberIssue(double number, double? minimum = null, double? maximum = null,
        string? field = null, bool exclusiveMinimum = false)
    {
        string Number(double value) => value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (!double.IsFinite(number))
            return new(field, "Value must be a finite number.", "Finite number", "Non-finite number");
        if (minimum is { } min && (number < min || exclusiveMinimum && number == min) ||
            maximum is { } max && number > max)
        {
            var range = minimum is { } lo && maximum is { } hi
                ? $"between {Number(lo)} and {Number(hi)}"
                : minimum is { } lower ? $"{(exclusiveMinimum ? "greater than" : "at least")} {Number(lower)}"
                : $"at most {Number(maximum!.Value)}";
            return new(field, $"Value must be {range}.", $"Number {range}", Number(number));
        }
        return null;
    }

    // Shared literal constraints for validation and external schema discovery.
    public sealed record NumericRange(double? Minimum = null, double? Maximum = null, bool ExclusiveMinimum = false);
    public const int FontFamilyMaxLength = 128;
    public const string FontFamilyPattern = @"^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$";
    public const int TypographyFontFamilyMaxLength = 256;
    public static NumericRange Range(TokenType type, TokenCategory? category = null, string? field = null) =>
        (type, category, field) switch
        {
            (TokenType.Dimension, TokenCategory.FontSize, _) => new(1, 1024),
            (TokenType.Dimension, TokenCategory.LetterSpacing, _) => new(-100, 100),
            (TokenType.Dimension, not null, _) => new(0, 1_000_000),
            (TokenType.Number, TokenCategory.LineHeight, _) => new(0.1, 10),
            (TokenType.Number, TokenCategory.Opacity, _) => new(0, 1),
            (TokenType.Geometry, _, _) => new(0),
            (TokenType.FontWeight, _, _) or (TokenType.Typography, _, "fontWeight") => new(1, 1000),
            (TokenType.Typography, _, "fontSize" or "lineHeight") => new(0, ExclusiveMinimum: true),
            (TokenType.Typography, _, "letterSpacing") => new(-100, 100),
            _ => new()
        };

    private static ValueIssue? CheckRange(double number, TokenType type, TokenCategory? category = null, string? field = null)
    {
        var range = Range(type, category, field);
        return NumberIssue(number, range.Minimum, range.Maximum, field, range.ExclusiveMinimum);
    }

    private static ValueIssue? LiteralIssue(DesignToken token, TokenValue? value)
    {
        if (!ValidCategory(token.Type, token.Category))
            return new(null, "Token category does not match its type.", "Compatible token category", "Unsupported category");
        return LiteralIssue(token.Type, value) ?? ((token.Type, token.Category, value) switch
        {
            (TokenType.Dimension, _, DimensionValue v) => CheckRange(v.Value, token.Type, token.Category),
            (TokenType.Number, _, NumberValue v) => CheckRange(v.Value, token.Type, token.Category),
            _ => null
        });
    }

    private static ValueIssue? LiteralIssue(TokenType type, TokenValue? value) => (type, value) switch
    {
        (TokenType.Color, ColorValue) => null,
        (TokenType.Spacing, SpacingValue spacing) => NumberIssue(spacing.Value),
        (TokenType.Geometry, GeometryValue geometry) => CheckRange(geometry.Radius, type),
        (TokenType.Dimension, DimensionValue dimension) => NumberIssue(dimension.Value),
        (TokenType.Number, NumberValue number) => NumberIssue(number.Value),
        (TokenType.FontFamily, FontFamilyValue family) => family.Value is { Length: > 0 and <= FontFamilyMaxLength } &&
            System.Text.RegularExpressions.Regex.IsMatch(family.Value, FontFamilyPattern, System.Text.RegularExpressions.RegexOptions.CultureInvariant)
                ? null : new(null, "Font family must be a valid name of 1 to 128 characters.",
                    "Font family name (1 to 128 characters)", "Invalid font family"),
        (TokenType.FontWeight, FontWeightValue weight) => CheckRange(weight.Value, type),
        (TokenType.Typography, TypographyValue typography) => TypographyIssue(typography),
        _ => new(null, "Literal value does not match token type.", type.ToString(), "Incompatible literal")
    };

    private static ValueIssue? TypographyIssue(TypographyValue typography)
    {
        if (string.IsNullOrWhiteSpace(typography.FontFamily) || typography.FontFamily.Length > TypographyFontFamilyMaxLength)
            return new("fontFamily", "Font family must be nonblank and at most 256 characters.",
                "Nonblank string with maximum length 256", "Invalid font family");
        return CheckRange(typography.FontSize, TokenType.Typography, field: "fontSize")
            ?? CheckRange(typography.FontWeight, TokenType.Typography, field: "fontWeight")
            ?? CheckRange(typography.LineHeight, TokenType.Typography, field: "lineHeight")
            ?? CheckRange(typography.LetterSpacing, TokenType.Typography, field: "letterSpacing");
    }
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
            {
                if (literal.Value is TypographyFieldsValue fields && token.Type == TokenType.Typography)
                {
                    var composite = ResolveTypography(token, fields, theme);
                    return Complete(composite);
                }
                return DesignTokenValidator.Matches(token, literal.Value)
                    ? Complete(new(literal.Value, [])) : Error("type-mismatch", token.Id, "Literal value does not match token type.");
            }
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

    // Inline Typography values in TextStyle use the same field resolver and constraints as tokens.
    internal TokenResolution ResolveInlineTypography(TypographyFieldsValue fields, TokenTheme theme, Guid ownerId, string name) =>
        ResolveTypography(new DesignToken(ownerId, name, TokenType.Typography,
            new Dictionary<TokenTheme, TokenExpression>()), fields, theme);

    private TokenResolution ResolveTypography(DesignToken owner, TypographyFieldsValue fields, TokenTheme theme)
    {
        TokenResolution Field(string path, TokenExpression expression)
        {
            var (expected, category) = DesignTokenValidator.TypographyFieldTypes[path];
            TokenResolution Error(string code, Guid? reference, string message) =>
                new(null, [new(code, owner.Id, theme, reference, $"{owner.Name}.{path}: {message}", path)]);
            if (expression is LiteralTokenValue literal)
            {
                var contract = new DesignToken(owner.Id, owner.Name, expected,
                    new Dictionary<TokenTheme, TokenExpression>(), category);
                return DesignTokenValidator.Matches(contract, literal.Value)
                    ? new(literal.Value, []) : Error("type-mismatch", null, "Invalid literal field value.");
            }
            if (expression is not TokenAlias alias)
                return Error("invalid-expression", null, "Expected a field literal or token reference.");
            if (Find(alias.TokenId) is not { } token)
                return Error("missing-reference", alias.TokenId, "Referenced atomic token does not exist.");
            if (token.Type != expected || token.Category != category)
                return Error("type-mismatch", alias.TokenId, "Referenced token is incompatible.");
            var result = Resolve(alias.TokenId, theme);
            return result.IsSuccess ? result : Error(result.Diagnostics[0].Code, alias.TokenId, result.Diagnostics[0].Message);
        }

        var family = Field("fontFamily", fields.FontFamily);
        if (!family.IsSuccess) return family;
        var size = Field("fontSize", fields.FontSize);
        if (!size.IsSuccess) return size;
        var weight = Field("fontWeight", fields.FontWeight);
        if (!weight.IsSuccess) return weight;
        var line = Field("lineHeight", fields.LineHeight);
        if (!line.IsSuccess) return line;
        var spacing = Field("letterSpacing", fields.LetterSpacing ?? new LiteralTokenValue(new DimensionValue(0)));
        if (!spacing.IsSuccess) return spacing;
        var flat = new TypographyValue(((FontFamilyValue)family.Value!).Value, ((DimensionValue)size.Value!).Value,
            ((FontWeightValue)weight.Value!).Value, ((NumberValue)line.Value!).Value, ((DimensionValue)spacing.Value!).Value);
        return DesignTokenValidator.Matches(TokenType.Typography, flat)
            ? new(flat, []) : new(null, [new("type-mismatch", owner.Id, theme, null, "Resolved typography fields are invalid.")]);
    }
}
