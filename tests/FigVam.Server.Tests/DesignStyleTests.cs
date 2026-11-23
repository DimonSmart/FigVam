using System.Collections.Immutable;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Tests;

public sealed class DesignStyleTests
{
    private static readonly VisualNodeProfile Profile = new();

    private static IReadOnlyDictionary<TokenTheme, TokenExpression> Both(TokenValue light, TokenValue dark) =>
        new Dictionary<TokenTheme, TokenExpression>
        {
            [TokenTheme.Light] = new LiteralTokenValue(light),
            [TokenTheme.Dark] = new LiteralTokenValue(dark)
        };

    private static DocumentStructure Document(IReadOnlyList<DesignStyle> styles,
        IReadOnlyList<DesignToken>? tokens = null) =>
        new(Guid.NewGuid(), [], [], []) { Profile = Profile.Identity, Styles = styles, Tokens = tokens ?? [] };

    private static NodeStructure Node(string kind, params (string Name, NodePropertyValue Value)[] properties) =>
        new(Guid.NewGuid(), kind, [])
        {
            Properties = properties.ToImmutableSortedDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal)
        };

    [Fact]
    public void InheritsTextColorAndResolvesCompositeTypographyAcrossThemes()
    {
        var colorId = Guid.NewGuid(); var sizeId = Guid.NewGuid();
        var typographyId = Guid.NewGuid(); var headingId = Guid.NewGuid();
        DesignToken[] tokens =
        [
            new(colorId, "ink", TokenType.Color,
                Both(new ColorValue(25, 25, 25), new ColorValue(250, 250, 250))),
            new(sizeId, "heading.size", TokenType.Dimension,
                Both(new DimensionValue(24), new DimensionValue(30)), TokenCategory.FontSize),
            new(typographyId, "body", TokenType.Typography,
                Both(new TypographyValue("Arial", 16, 400, 1.25), new TypographyValue("Arial", 17, 400, 1.25))),
            new(headingId, "heading", TokenType.Typography,
                Both(new TypographyFieldsValue(
                    new LiteralTokenValue(new FontFamilyValue("Verdana")),
                    new TokenAlias(sizeId),
                    new LiteralTokenValue(new FontWeightValue(700)),
                    new LiteralTokenValue(new NumberValue(1.5))),
                    new TypographyFieldsValue(
                    new LiteralTokenValue(new FontFamilyValue("Verdana")),
                    new TokenAlias(sizeId),
                    new LiteralTokenValue(new FontWeightValue(700)),
                    new LiteralTokenValue(new NumberValue(1.5)))))
        ];
        var baseId = Guid.NewGuid(); var childId = Guid.NewGuid();
        DesignStyle[] styles =
        [
            new(baseId, "text.base", DesignStyleType.TextStyle,
                new Dictionary<string, NodePropertyValue>
                {
                    ["typography"] = new NodeTokenValue(typographyId),
                    ["textColor"] = new NodeTokenValue(colorId)
                }),
            new(childId, "text.heading", DesignStyleType.TextStyle,
                new Dictionary<string, NodePropertyValue> { ["typography"] = new NodeTokenValue(headingId) },
                baseId)
        ];
        var doc = Document(styles, tokens);
        Assert.Empty(DesignTokenValidator.Validate(tokens));
        Assert.Empty(DesignStyleValidator.Validate(doc, Profile));
        var node = Node("Text", ("textStyle", new NodeStyleValue(childId)));
        var resolver = new DesignStyleResolver(doc, Profile);
        var light = resolver.EffectiveNode(node, TokenTheme.Light);
        var dark = resolver.EffectiveNode(node, TokenTheme.Dark);
        Assert.Equal(new NodeNumberValue(24), light["fontSize"]);
        Assert.Equal(new NodeNumberValue(30), dark["fontSize"]);
        Assert.Equal(new NodeColorValue(25, 25, 25), light["textColor"]);
        Assert.Equal(new NodeColorValue(250, 250, 250), dark["textColor"]);
        Assert.Equal(new NodeNumberValue(700), light["fontWeight"]);
        Assert.Equal(new NodeStringValue("Verdana"), dark["fontFamily"]);

        var changed = doc with { Tokens = tokens.Select(t => t.Id == colorId
            ? t with { Values = Both(new ColorValue(77, 1, 2), new ColorValue(11, 12, 13)) } : t).ToArray() };
        var updated = new DesignStyleResolver(changed, Profile).EffectiveNode(node, TokenTheme.Light);
        Assert.Equal(new NodeColorValue(77, 1, 2), updated["textColor"]);
        Assert.Equal(new NodeNumberValue(24), updated["fontSize"]);
    }

    [Fact]
    public void ExplicitNodeSizeOverridesStyleAndResetRemovesOnlyLocalField()
    {
        var id = Guid.NewGuid();
        var text = new DesignStyle(id, "text", DesignStyleType.TextStyle,
            new Dictionary<string, NodePropertyValue>
            {
                ["typography"] = new NodeTypographyValue(new TypographyValue("Arial", 20, 600, 1.4)),
                ["textColor"] = new NodeColorValue(5, 6, 7)
            });
        var doc = Document([text]);
        var node = Node("Text", ("textStyle", new NodeStyleValue(id)), ("fontSize", new NodeNumberValue(33)));
        Assert.Empty(DesignStyleValidator.Validate(doc, Profile));
        var resolver = new DesignStyleResolver(doc, Profile);
        Assert.Equal(new NodeNumberValue(33), resolver.EffectiveNode(node, TokenTheme.Light)["fontSize"]);
        var reset = node with { Properties = node.Properties.Remove("fontSize") };
        var effective = resolver.EffectiveNode(reset, TokenTheme.Light);
        Assert.Equal(new NodeNumberValue(20), effective["fontSize"]);
        Assert.Equal(new NodeColorValue(5, 6, 7), effective["textColor"]);
        Assert.True(reset.Properties.ContainsKey("textStyle"));
        Assert.False(reset.Properties.ContainsKey("fontSize"));
    }

    [Fact]
    public void BorderStyleIsSharedAndIndividualWidthRemainsLocal()
    {
        var id = Guid.NewGuid();
        var border = new DesignStyle(id, "border.base", DesignStyleType.BorderStyle,
            new Dictionary<string, NodePropertyValue>
            {
                ["borderColor"] = new NodeColorValue(10, 20, 30),
                ["borderWidth"] = new NodeNumberValue(2),
                ["cornerRadius"] = new NodeNumberValue(8)
            });
        var doc = Document([border]);
        Assert.Empty(DesignStyleValidator.Validate(doc, Profile));
        var frame = Node("Frame", ("borderStyle", new NodeStyleValue(id)));
        var button = Node("Button", ("borderStyle", new NodeStyleValue(id)),
            ("borderWidth", new NodeNumberValue(5)));
        var resolver = new DesignStyleResolver(doc, Profile);
        Assert.Equal(new NodeNumberValue(8), resolver.EffectiveNode(frame, TokenTheme.Light)["cornerRadius"]);
        Assert.Equal(new NodeNumberValue(5), resolver.EffectiveNode(button, TokenTheme.Light)["borderWidth"]);
        var changed = border with { Fields = border.Fields.ToDictionary(pair => pair.Key, pair => pair.Value)
            { ["cornerRadius"] = new NodeNumberValue(12) } };
        resolver = new DesignStyleResolver(doc with { Styles = [changed] }, Profile);
        Assert.Equal(new NodeNumberValue(12), resolver.EffectiveNode(frame, TokenTheme.Light)["cornerRadius"]);
        Assert.Equal(new NodeNumberValue(12), resolver.EffectiveNode(button, TokenTheme.Light)["cornerRadius"]);
        Assert.Equal(new NodeNumberValue(5), resolver.EffectiveNode(button, TokenTheme.Light)["borderWidth"]);
    }

    [Fact]
    public void ScreenVariantStyleAndExplicitColorHavePredictablePrecedence()
    {
        var baseId = Guid.NewGuid(); var dangerId = Guid.NewGuid();
        var doc = Document(
        [
            new(baseId, "base", DesignStyleType.TextStyle, new Dictionary<string, NodePropertyValue>
            {
                ["textColor"] = new NodeColorValue(0, 0, 0),
                ["typography"] = new NodeTypographyValue(new TypographyValue("Arial", 18, 400, 1.2))
            }),
            new(dangerId, "danger", DesignStyleType.TextStyle, new Dictionary<string, NodePropertyValue>
            {
                ["textColor"] = new NodeColorValue(200, 0, 0)
            })
        ]);
        var node = Node("Text", ("textStyle", new NodeStyleValue(baseId)),
            ("fontSize", new NodeNumberValue(22)));
        var variant = new Dictionary<string, NodePropertyValue>
        {
            ["textStyle"] = new NodeStyleValue(dangerId),
            ["textColor"] = new NodeColorValue(255, 255, 255)
        };
        var effective = new DesignStyleResolver(doc, Profile).EffectiveNode(node, TokenTheme.Light, variant);
        Assert.Equal(new NodeColorValue(255, 255, 255), effective["textColor"]);
        Assert.Equal(new NodeNumberValue(22), effective["fontSize"]);
        var resetColor = variant.Where(pair => pair.Key != "textColor")
            .ToDictionary(pair => pair.Key, pair => pair.Value);
        effective = new DesignStyleResolver(doc, Profile).EffectiveNode(node, TokenTheme.Light, resetColor);
        Assert.Equal(new NodeColorValue(200, 0, 0), effective["textColor"]);
    }

    [Fact]
    public void RejectsCyclesWrongParentAndInvalidTokenWithoutFallback()
    {
        var firstId = Guid.NewGuid(); var secondId = Guid.NewGuid();
        var first = new DesignStyle(firstId, "first", DesignStyleType.TextStyle,
            new Dictionary<string, NodePropertyValue>(), secondId);
        var second = new DesignStyle(secondId, "second", DesignStyleType.TextStyle,
            new Dictionary<string, NodePropertyValue>(), firstId);
        Assert.Contains(DesignStyleValidator.Validate(Document([first, second]), Profile),
            e => e.Code == "style-cycle");
        Assert.Contains(DesignStyleValidator.Validate(Document([first,
            second with { Type = DesignStyleType.BorderStyle, BasedOnStyleId = null }]), Profile),
            e => e.Code == "type-mismatch" && e.Property == "basedOnStyleId");
        var broken = first with { BasedOnStyleId = null, Fields = new Dictionary<string, NodePropertyValue>
        {
            ["textColor"] = new NodeTokenValue(Guid.NewGuid())
        } };
        Assert.Contains(DesignStyleValidator.Validate(Document([broken]), Profile),
            e => e.Code == "missing-reference" && e.Property == "textColor");
    }
}
