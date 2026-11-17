using FigVam.Domain.Tokens;

namespace FigVam.Server.Tests;

public class DesignTokenTests
{
    private static IReadOnlyDictionary<TokenTheme, TokenExpression> Both(TokenExpression light, TokenExpression dark) =>
        new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = light, [TokenTheme.Dark] = dark };
    private static LiteralTokenValue Literal(TokenValue value) => new(value);

    [Fact]
    public void ResolvesTypedValuesAndAliasesAcrossThemesAfterRename()
    {
        var color = Guid.NewGuid(); var semantic = Guid.NewGuid();
        DesignToken[] tokens =
        [
            new(color, "Palette", TokenType.Color, Both(Literal(new ColorValue(255, 255, 255)), Literal(new ColorValue(0, 0, 0)))),
            new(semantic, "Surface", TokenType.Color, Both(new TokenAlias(color), new TokenAlias(color))),
            new(Guid.NewGuid(), "Gap", TokenType.Spacing, Both(Literal(new SpacingValue(8)), Literal(new SpacingValue(12)))),
            new(Guid.NewGuid(), "Body", TokenType.Typography, Both(Literal(new TypographyValue("Arial", 16, 400, 20)), Literal(new TypographyValue("Arial", 16, 400, 20)))),
            new(Guid.NewGuid(), "Corner", TokenType.Geometry, Both(Literal(new GeometryValue(4)), Literal(new GeometryValue(4))))
        ];
        Assert.Empty(DesignTokenValidator.Validate(tokens));
        tokens[0] = tokens[0] with { Name = "Renamed" };
        Assert.Equal(new ColorValue(255, 255, 255), DesignTokenValidator.Resolve(tokens, semantic, TokenTheme.Light).Value);
        Assert.Equal(new ColorValue(0, 0, 0), DesignTokenValidator.Resolve(tokens, semantic, TokenTheme.Dark).Value);
    }

    [Fact]
    public void ReportsMissingReferencesAndIncompleteThemes()
    {
        var id = Guid.NewGuid(); var missing = Guid.NewGuid();
        DesignToken[] tokens = [new(id, "Surface", TokenType.Color,
            new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = new TokenAlias(missing) })];
        var errors = DesignTokenValidator.Validate(tokens);
        Assert.Contains(errors, e => e.Code == "missing-reference" && e.ReferenceId == missing && e.Theme == TokenTheme.Light);
        Assert.Contains(errors, e => e.Code == "incomplete-theme" && e.TokenId == id && e.Theme == TokenTheme.Dark);
        Assert.False(DesignTokenValidator.Resolve(tokens, id, TokenTheme.Light).IsSuccess);
    }

    [Fact]
    public void ReportsLiteralAndAliasTypeMismatches()
    {
        var color = Guid.NewGuid(); var spacing = Guid.NewGuid();
        DesignToken[] tokens =
        [
            new(color, "Color", TokenType.Color, Both(Literal(new SpacingValue(3)), new TokenAlias(spacing))),
            new(spacing, "Space", TokenType.Spacing, Both(Literal(new SpacingValue(1)), Literal(new SpacingValue(2))))
        ];
        var errors = DesignTokenValidator.Validate(tokens);
        Assert.Contains(errors, e => e.Code == "type-mismatch" && e.Theme == TokenTheme.Light && e.ReferenceId is null);
        Assert.Contains(errors, e => e.Code == "type-mismatch" && e.Theme == TokenTheme.Dark && e.ReferenceId == spacing);
    }

    [Fact]
    public void ReportsCyclesPerThemeAndDuplicateIds()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        DesignToken[] tokens =
        [
            new(a, "A", TokenType.Spacing, Both(new TokenAlias(b), Literal(new SpacingValue(1)))),
            new(b, "B", TokenType.Spacing, Both(new TokenAlias(a), Literal(new SpacingValue(2))))
        ];
        var errors = DesignTokenValidator.Validate(tokens);
        Assert.Contains(errors, e => e.Code == "alias-cycle" && e.Theme == TokenTheme.Light);
        Assert.DoesNotContain(errors, e => e.Code == "alias-cycle" && e.Theme == TokenTheme.Dark);
        Assert.Contains(DesignTokenValidator.Validate([tokens[0], tokens[0]]), e => e.Code == "duplicate-id");
    }
}
