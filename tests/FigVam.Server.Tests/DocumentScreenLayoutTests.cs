using System.Collections.Immutable;
using FigVam.Domain.Documents;
using FigVam.Domain.Layout;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Tests;

public sealed class DocumentScreenLayoutTests
{
    private static readonly VisualNodeProfile Profile = new();

    [Fact]
    public void FreePlacementUsesProfileDefaultsAndScreenLayerOrder()
    {
        var first = Node("Text", properties: [("x", new NodeNumberValue(-4)), ("y", new NodeNumberValue(170))]);
        var second = Node("Button");
        var document = Document([first.Id, second.Id], second, first);
        var layout = Calculate(document);

        Assert.Empty(layout.Diagnostics);
        Assert.Equal(new[] { document.Screens[0].Id, first.Id, second.Id }, layout.Boxes.Select(box => box.ObjectId));
        Assert.Equal(new LayoutRect(-4, 170, 160, 36), Box(layout, first).Bounds);
        Assert.Equal(new LayoutRect(0, 0, 120, 40), Box(layout, second).Bounds);
        Assert.Equal(new LayoutRect(0, 0, 300, 200), Box(layout, first).Clip);
        Assert.Empty(second.Properties);
    }

    [Fact]
    public void NestedStacksUseBothAlignmentsPaddingGapAndCurrentParentSize()
    {
        var first = Node("Text", properties: [("width", new NodeNumberValue(20)), ("height", new NodeNumberValue(10)), ("x", new NodeNumberValue(900))]);
        var second = Node("Text", properties: [("width", new NodeNumberValue(30)), ("height", new NodeNumberValue(12))]);
        var nested = Node("Frame", [first.Id, second.Id],
            ("width", new NodeNumberValue(80)), ("height", new NodeNumberValue(50)), ("layout", new NodeEnumValue("Vertical")),
            ("paddingLeft", new NodeNumberValue(3)), ("paddingTop", new NodeNumberValue(4)),
            ("paddingRight", new NodeNumberValue(7)), ("paddingBottom", new NodeNumberValue(6)),
            ("gap", new NodeNumberValue(6)), ("mainAlignment", new NodeEnumValue("End")), ("crossAlignment", new NodeEnumValue("Center")));
        var button = Node("Button", properties: [("width", new NodeNumberValue(40)), ("height", new NodeNumberValue(30))]);
        var parent = Node("Frame", [nested.Id, button.Id],
            ("width", new NodeNumberValue(200)), ("height", new NodeNumberValue(120)), ("layout", new NodeEnumValue("Horizontal")),
            ("x", new NodeNumberValue(20)), ("y", new NodeNumberValue(15)), ("paddingLeft", new NodeNumberValue(11)),
            ("paddingTop", new NodeNumberValue(8)), ("paddingRight", new NodeNumberValue(9)), ("paddingBottom", new NodeNumberValue(12)),
            ("gap", new NodeNumberValue(10)), ("mainAlignment", new NodeEnumValue("Center")), ("crossAlignment", new NodeEnumValue("End")));
        var document = Document([parent.Id], first, second, nested, button, parent);

        var layout = Calculate(document);
        Assert.Empty(layout.Diagnostics);
        Assert.Equal(new[] { document.Screens[0].Id, parent.Id, nested.Id, first.Id, second.Id, button.Id }, layout.Boxes.Select(box => box.ObjectId));
        Assert.Equal(new LayoutRect(56, 73, 80, 50), Box(layout, nested).Bounds);
        Assert.Equal(new LayoutRect(84, 89, 20, 10), Box(layout, first).Bounds);
        Assert.Equal(new LayoutRect(79, 105, 30, 12), Box(layout, second).Bounds);
        Assert.Equal(new LayoutRect(146, 93, 40, 30), Box(layout, button).Bounds);

        var resized = DocumentStructureEditor.SetNodeProperties(document, parent.Id,
            [new("width", new NodeNumberValue(260)), new("height", new NodeNumberValue(140))]);
        Assert.Equal(new LayoutRect(114, 109, 20, 10), Box(Calculate(resized), first).Bounds);
        Assert.Equal(new NodeNumberValue(900), first.Properties["x"]);
    }

    [Theory]
    [InlineData(TokenTheme.Light, 8)]
    [InlineData(TokenTheme.Dark, 16)]
    public void SpacingTokensAndAliasesUseThemeWithoutChangingNodeProperties(TokenTheme theme, double spacing)
    {
        var token = Token(TokenType.Spacing, new SpacingValue(8), new SpacingValue(16));
        var alias = token with { Id = Guid.NewGuid(), Values = new Dictionary<TokenTheme, TokenExpression>
            { [TokenTheme.Light] = new TokenAlias(token.Id), [TokenTheme.Dark] = new TokenAlias(token.Id) } };
        var first = Node("Text");
        var second = Node("Text");
        var parent = Node("Frame", [first.Id, second.Id], ("layout", new NodeEnumValue("Vertical")),
            ("paddingLeft", new NodeTokenValue(token.Id)), ("paddingTop", new NodeNumberValue(3)),
            ("gap", new NodeTokenValue(alias.Id)));
        var document = Document([parent.Id], first, second, parent) with { Tokens = [token, alias] };

        var result = DocumentScreenLayout.Calculate(document, document.Screens[0].Id, Profile, theme: theme);

        Assert.Empty(result.Diagnostics);
        Assert.Equal(new LayoutRect(spacing, 3, 160, 36), Box(result, first).Bounds);
        Assert.Equal(new LayoutRect(spacing, 39 + spacing, 160, 36), Box(result, second).Bounds);
        Assert.Equal(new NodeTokenValue(alias.Id), document.Nodes.Single(node => node.Id == parent.Id).Properties["gap"]);
    }

    [Theory]
    [InlineData("missing-reference")]
    [InlineData("type-mismatch")]
    [InlineData("alias-cycle")]
    [InlineData("incomplete-theme")]
    [InlineData("INVALID_PROPERTY_VALUE")]
    public void InvalidSpacingReferencesReportNodeAndProperty(string code)
    {
        var id = Guid.NewGuid();
        var token = Token(TokenType.Spacing, new SpacingValue(3), new SpacingValue(-1)) with { Id = id };
        DesignToken[] tokens = code switch
        {
            "missing-reference" => [token with { Values = token.Values.ToDictionary(item => item.Key, _ => (TokenExpression)new TokenAlias(Guid.NewGuid())) }],
            "type-mismatch" => [Token(TokenType.Color, new ColorValue(0, 0, 0), new ColorValue(0, 0, 0)) with { Id = id }],
            "alias-cycle" => [token with { Values = token.Values.ToDictionary(item => item.Key, _ => (TokenExpression)new TokenAlias(id)) }],
            "incomplete-theme" => [token with { Values = new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = token.Values[TokenTheme.Light] } }],
            _ => [token]
        };
        var parent = Node("Frame", properties: [("paddingRight", new NodeTokenValue(id))]);
        var document = Document([parent.Id], parent) with { Tokens = tokens };

        var result = DocumentScreenLayout.Calculate(document, document.Screens[0].Id, Profile, theme: TokenTheme.Dark);
        Assert.Empty(result.Boxes);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal((code, parent.Id, "paddingRight"), (diagnostic.Code, diagnostic.ObjectId, diagnostic.Property));
        if (code == "INVALID_PROPERTY_VALUE")
        {
            Assert.Contains("Dark", diagnostic.Message);
            Assert.Empty(Calculate(document).Diagnostics);
        }
    }

    [Theory]
    [InlineData("Clip", 60, 50, 40, 30)]
    [InlineData("Visible", 0, 0, 100, 80)]
    public void FrameOverflowPreservesBoundsAndControlsDescendantClipping(string overflow,
        double clipX, double clipY, double clipWidth, double clipHeight)
    {
        var child = Node("Text", properties: [("x", new NodeNumberValue(-20)), ("y", new NodeNumberValue(-5))]);
        var frame = Node("Frame", [child.Id], ("x", new NodeNumberValue(60)), ("y", new NodeNumberValue(50)),
            ("width", new NodeNumberValue(70)), ("height", new NodeNumberValue(70)), ("overflow", new NodeEnumValue(overflow)));
        var document = Document([frame.Id], child, frame);
        document = document with { Screens = [document.Screens[0] with { Dimensions = new(100, 80) }] };

        var layout = Calculate(document);
        Assert.Empty(layout.Diagnostics);
        Assert.Equal(new LayoutRect(40, 45, 160, 36), Box(layout, child).Bounds);
        Assert.Equal(new LayoutRect(clipX, clipY, clipWidth, clipHeight), Box(layout, child).Clip);
    }

    [Theory]
    [InlineData("Fill")]
    [InlineData("Content")]
    public void UnsupportedSizeModesDoNotProducePartialGeometry(string mode)
    {
        var valid = Node("Text");
        var invalid = Node("Text", properties: [("heightMode", new NodeEnumValue(mode))]);
        var result = Calculate(Document([valid.Id, invalid.Id], valid, invalid));
        Assert.Empty(result.Boxes);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal("unsupported-size-mode", diagnostic.Code);
        Assert.Equal(invalid.Id, diagnostic.ObjectId);
        Assert.Equal("heightMode", diagnostic.Property);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(1_000_001)]
    public void DimensionsMustSatisfyProfileLimits(double width)
    {
        var node = Node("Text", properties: [("width", new NodeNumberValue(width))]);
        var result = Calculate(Document([node.Id], node));
        Assert.Empty(result.Boxes);
        Assert.Contains(result.Diagnostics, item => item.Code == "INVALID_PROPERTY_VALUE" && item.ObjectId == node.Id && item.Property == "width");
    }

    [Fact]
    public void MalformedNestingAndScreenDimensionsProduceAddressedDiagnostics()
    {
        var child = Node("Text");
        var parent = Node("Text", [child.Id]);
        var document = Document([parent.Id], parent, child);
        var diagnostic = Assert.Single(Calculate(document).Diagnostics);
        Assert.Equal("children-not-allowed", diagnostic.Code);
        Assert.Equal(parent.Id, diagnostic.ObjectId);

        var screen = document.Screens[0] with { Dimensions = new(-1, 80) };
        var invalidScreen = Assert.Single(Calculate(document with { Screens = [screen] }).Diagnostics);
        Assert.Equal("INVALID_SCREEN_DIMENSIONS", invalidScreen.Code);
        Assert.Equal(screen.Id, invalidScreen.ObjectId);

        var missingChild = Assert.Single(Calculate(document with { Nodes = [] }).Diagnostics);
        Assert.Equal("missing-child", missingChild.Code);
        Assert.Equal(screen.Id, missingChild.ObjectId);
    }

    [Fact]
    public void InstalledLegacyProfileDoesNotSilentlyUseVersionTwoNodeDefaults()
    {
        var node = Node("Text");
        var document = Document([node.Id], node) with { Profile = PortableUiProfileReference.Version1 };
        var result = Calculate(document);
        Assert.Empty(result.Boxes);
        Assert.Equal("unknown-node-kind", Assert.Single(result.Diagnostics).Code);
    }

    private static NodeStructure Node(string kind, Guid[]? children = null, params (string Name, NodePropertyValue Value)[] properties) =>
        new(Guid.NewGuid(), kind, children ?? [])
        {
            Properties = properties.ToImmutableSortedDictionary(pair => pair.Name, pair => pair.Value, StringComparer.Ordinal)
        };

    private static DocumentStructure Document(Guid[] children, params NodeStructure[] nodes) =>
        new(Guid.NewGuid(), [], [new(Guid.NewGuid(), children, new(300, 200))], nodes)
        {
            Profile = Profile.Identity
        };

    private static LayoutResult Calculate(DocumentStructure document) => DocumentScreenLayout.Calculate(document, document.Screens[0].Id, Profile);
    private static LayoutBox Box(LayoutResult result, NodeStructure node) => Assert.Single(result.Boxes, box => box.ObjectId == node.Id);
    private static DesignToken Token(TokenType type, TokenValue light, TokenValue dark) =>
        new(Guid.NewGuid(), "Spacing", type, new Dictionary<TokenTheme, TokenExpression>
        {
            [TokenTheme.Light] = new LiteralTokenValue(light),
            [TokenTheme.Dark] = new LiteralTokenValue(dark)
        });
}
