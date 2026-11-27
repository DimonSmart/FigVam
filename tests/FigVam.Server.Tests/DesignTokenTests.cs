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
    public void ShadowFieldsResolveThemeAndAlphaAndRejectIncompatibleReference()
    {
        var colorId = Guid.NewGuid(); var shadowId = Guid.NewGuid(); var aliasId = Guid.NewGuid();
        var shadow = new ShadowFieldsValue(0, 4, 8, 0, new TokenAlias(aliasId));
        DesignToken[] tokens =
        [
            new(colorId, "palette", TokenType.Color, Both(Literal(new ColorValue(0, 0, 0, 32)), Literal(new ColorValue(255, 255, 255, 96)))),
            new(aliasId, "semantic", TokenType.Color, Both(new TokenAlias(colorId), new TokenAlias(colorId))),
            new(shadowId, "shadow", TokenType.Shadow, Both(Literal(shadow), Literal(shadow)))
        ];
        Assert.Empty(DesignTokenValidator.Validate(tokens));
        Assert.Equal(32, Assert.IsType<ShadowValue>(DesignTokenValidator.Resolve(tokens, shadowId, TokenTheme.Light).Value).Color.Alpha);
        Assert.Equal(96, Assert.IsType<ShadowValue>(DesignTokenValidator.Resolve(tokens, shadowId, TokenTheme.Dark).Value).Color.Alpha);
        tokens[2] = tokens[2] with { Values = Both(Literal(shadow with { Color = new TokenAlias(shadowId) }), Literal(shadow)) };
        Assert.Contains(DesignTokenValidator.Validate(tokens), e => e.Code == "type-mismatch" && e.TokenId == shadowId);
        Assert.False(DesignTokenValidator.Resolve(tokens, shadowId, TokenTheme.Light).IsSuccess);
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

    [Fact]
    public void CompositeTypographyResolvesFieldReferencesForEachTheme()
    {
        var familyId = Guid.NewGuid(); var sizeId = Guid.NewGuid();
        var weightId = Guid.NewGuid(); var lineId = Guid.NewGuid();
        var textId = Guid.NewGuid(); var aliasId = Guid.NewGuid();
        var composite = new TypographyFieldsValue(
            new TokenAlias(familyId), new TokenAlias(sizeId), new TokenAlias(weightId), new TokenAlias(lineId));
        DesignToken[] tokens =
        [
            new(familyId, "font.base", TokenType.FontFamily,
                Both(Literal(new FontFamilyValue("Arial")), Literal(new FontFamilyValue("Verdana")))),
            new(sizeId, "size.heading", TokenType.Dimension,
                Both(Literal(new DimensionValue(24)), Literal(new DimensionValue(28))), TokenCategory.FontSize),
            new(weightId, "weight.strong", TokenType.FontWeight,
                Both(Literal(new FontWeightValue(700)), Literal(new FontWeightValue(600)))),
            new(lineId, "leading", TokenType.Number,
                Both(Literal(new NumberValue(1.5)), Literal(new NumberValue(1.25))), TokenCategory.LineHeight),
            new(textId, "typography.heading", TokenType.Typography, Both(Literal(composite), Literal(composite))),
            new(aliasId, "typography.alias", TokenType.Typography, Both(new TokenAlias(textId), new TokenAlias(textId)))
        ];
        Assert.Empty(DesignTokenValidator.Validate(tokens));
        Assert.Equal(new TypographyValue("Arial", 24, 700, 1.5),
            DesignTokenValidator.Resolve(tokens, aliasId, TokenTheme.Light).Value);
        Assert.Equal(new TypographyValue("Verdana", 28, 600, 1.25),
            DesignTokenValidator.Resolve(tokens, textId, TokenTheme.Dark).Value);
    }

    [Fact]
    public void CompositeTypographyRejectsWrongCategoryMissingAndInvalidFieldValue()
    {
        var sizeId = Guid.NewGuid(); var textId = Guid.NewGuid();
        var missing = Guid.NewGuid();
        var fields = new TypographyFieldsValue(
            new LiteralTokenValue(new FontFamilyValue("Arial")),
            new TokenAlias(sizeId),
            new LiteralTokenValue(new FontWeightValue(1200)),
            new TokenAlias(missing));
        DesignToken[] tokens =
        [
            new(sizeId, "size.wrong", TokenType.Dimension,
                Both(Literal(new DimensionValue(18)), Literal(new DimensionValue(18))), TokenCategory.Radius),
            new(textId, "composite", TokenType.Typography, Both(Literal(fields), Literal(fields)))
        ];
        var errors = DesignTokenValidator.Validate(tokens);
        Assert.Contains(errors, d => d.Code == "type-mismatch" && d.TokenId == textId && d.Field == "fontSize");
        Assert.Contains(errors, d => d.Code == "type-mismatch" && d.TokenId == textId && d.Field == "fontWeight");
        Assert.Contains(errors, d => d.Code == "missing-reference" && d.TokenId == textId && d.Field == "lineHeight" && d.ReferenceId == missing);
        Assert.False(DesignTokenValidator.Resolve(tokens, textId, TokenTheme.Light).IsSuccess);
    }
}
