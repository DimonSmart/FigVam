using System.Collections.Immutable;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Layout;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class PortableUiV4TokenTests
{
    private static readonly VisualNodeProfile Installed = new();
    private static readonly INodeProfile Profile = Installed.GetInstalledVersion(4)!;

    private static IReadOnlyDictionary<TokenTheme, TokenExpression> Values(TokenExpression light, TokenExpression dark) =>
        new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = light, [TokenTheme.Dark] = dark };

    private static DesignToken Dimension(TokenCategory category, double light, double dark, string? name = null) =>
        new(Guid.NewGuid(), name ?? category.ToString(), TokenType.Dimension,
            Values(new LiteralTokenValue(new DimensionValue(light)), new LiteralTokenValue(new DimensionValue(dark))), category);

    private static DesignToken Number(TokenCategory category, double light, double dark) =>
        new(Guid.NewGuid(), category.ToString(), TokenType.Number,
            Values(new LiteralTokenValue(new NumberValue(light)), new LiteralTokenValue(new NumberValue(dark))), category);

    private static DocumentStructure Document(NodeStructure node, params DesignToken[] tokens)
    {
        var screenId = Guid.NewGuid();
        return new(Guid.NewGuid(), [new PageStructure(Guid.NewGuid(), [screenId])],
            [new ScreenStructure(screenId, [node.Id], new(800, 600))], [node])
        {
            Profile = PortableUiProfileReference.Version4, Tokens = tokens
        };
    }

    [Fact]
    public void V4KeepsAllOlderPropertyContractsAndEnumDiscriminators()
    {
        Assert.Equal(4, Profile.Identity.Version);
        Assert.Equal(3, Installed.Identity.Version);
        Assert.Null(Installed.GetProperty("Text", "fontSize")!.TokenType);
        Assert.Equal(TokenType.Dimension, Profile.GetProperty("Text", "fontSize")!.TokenType);
        Assert.Equal(TokenCategory.FontSize, Profile.GetProperty("Text", "fontSize")!.TokenCategory);
        Assert.Equal(TokenType.FontFamily, Profile.GetProperty("Button", "fontFamily")!.TokenType);
        Assert.Equal(TokenType.Number, Profile.GetProperty("Image", "opacity")!.TokenType);
        Assert.Equal(TokenCategory.Size, Profile.GetProperty("Image", "width")!.TokenCategory);
        Assert.Equal(TokenType.Spacing, Profile.GetProperty("Frame", "gap")!.LegacyTokenType);
        Assert.Equal(TokenType.Geometry, Profile.GetProperty("Button", "cornerRadius")!.LegacyTokenType);
        Assert.Null(Profile.GetProperty("Frame", "x")!.TokenType);
        Assert.Null(Profile.GetProperty("Frame", "widthMode")!.TokenType);
        Assert.Equal(0, (int)TokenType.Color);
        Assert.Equal(1, (int)TokenType.Spacing);
        Assert.Equal(2, (int)TokenType.Typography);
        Assert.Equal(3, (int)TokenType.Geometry);
    }

    [Fact]
    public void CategorizedAliasesResolvePerThemeAndRejectIncompatibleCategoriesAndCycles()
    {
        var baseSize = Dimension(TokenCategory.FontSize, 16, 18, "font.size.base");
        var semantic = baseSize with
        {
            Id = Guid.NewGuid(), Name = "font.size.body",
            Values = Values(new TokenAlias(baseSize.Id), new TokenAlias(baseSize.Id))
        };
        var chain = semantic with
        {
            Id = Guid.NewGuid(), Name = "font.size.content",
            Values = Values(new TokenAlias(semantic.Id), new TokenAlias(semantic.Id))
        };
        Assert.Empty(DesignTokenValidator.Validate([baseSize, semantic, chain]));
        Assert.Equal(new DimensionValue(16), DesignTokenValidator.Resolve([baseSize, semantic, chain],
            chain.Id, TokenTheme.Light).Value);
        Assert.Equal(new DimensionValue(18), DesignTokenValidator.Resolve([baseSize, semantic, chain],
            chain.Id, TokenTheme.Dark).Value);

        var incompatible = Dimension(TokenCategory.BorderWidth, 2, 2) with
        {
            Values = Values(new TokenAlias(baseSize.Id), new TokenAlias(baseSize.Id))
        };
        Assert.Contains(DesignTokenValidator.Validate([baseSize, incompatible]),
            diagnostic => diagnostic.Code == "type-mismatch" && diagnostic.ReferenceId == baseSize.Id);
        var cycle = chain with { Values = Values(new TokenAlias(chain.Id), new TokenAlias(chain.Id)) };
        Assert.Contains(DesignTokenValidator.Validate([cycle]),
            diagnostic => diagnostic.Code == "alias-cycle");
    }

    [Fact]
    public void V4AcceptsAllAtomicVisualPropertiesAndRejectsCrossCategoryReferences()
    {
        var fontSize = Dimension(TokenCategory.FontSize, 16, 19);
        var family = new DesignToken(Guid.NewGuid(), "family", TokenType.FontFamily,
            Values(new LiteralTokenValue(new FontFamilyValue("Inter")), new LiteralTokenValue(new FontFamilyValue("Arial"))));
        var weight = new DesignToken(Guid.NewGuid(), "weight", TokenType.FontWeight,
            Values(new LiteralTokenValue(new FontWeightValue(450)), new LiteralTokenValue(new FontWeightValue(700))));
        var lineHeight = Number(TokenCategory.LineHeight, 1.2, 1.6);
        var opacity = Number(TokenCategory.Opacity, 0.8, 0.5);
        var width = Dimension(TokenCategory.Size, 200, 220);
        var text = new NodeStructure(Guid.NewGuid(), "Text", [])
        {
            Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty
                .Add("fontSize", new NodeTokenValue(fontSize.Id))
                .Add("fontFamily", new NodeTokenValue(family.Id))
                .Add("fontWeight", new NodeTokenValue(weight.Id))
                .Add("lineHeight", new NodeTokenValue(lineHeight.Id))
                .Add("opacity", new NodeTokenValue(opacity.Id))
                .Add("width", new NodeTokenValue(width.Id))
        };
        var doc = Document(text, fontSize, family, weight, lineHeight, opacity, width);
        Assert.Empty(DocumentStructureValidator.Validate(doc, Installed));
        var light = DocumentScreenLayout.Calculate(doc, doc.Screens[0].Id, Installed);
        var dark = DocumentScreenLayout.Calculate(doc, doc.Screens[0].Id, Installed, theme: TokenTheme.Dark);
        Assert.Empty(light.Diagnostics);
        Assert.Empty(dark.Diagnostics);
        Assert.Equal(200, Assert.Single(light.Boxes, box => box.ObjectId == text.Id).Bounds.Width);
        Assert.Equal(220, Assert.Single(dark.Boxes, box => box.ObjectId == text.Id).Bounds.Width);

        var invalid = doc with { Nodes = [text with
        {
            Properties = text.Properties.SetItem("fontSize", new NodeTokenValue(width.Id))
        }] };
        Assert.Contains(DocumentStructureValidator.Validate(invalid, Installed),
            error => error.Code == "type-mismatch" && error.Property == "fontSize");
        Assert.Equal("INVALID_PROPERTY_TYPE",
            NodePropertyValidator.Validate(Installed, "Text", "text", new NodeTokenValue(fontSize.Id))!.Code);
        Assert.Equal("INVALID_PROPERTY_TYPE",
            NodePropertyValidator.Validate(Installed, "Text", "x", new NodeTokenValue(width.Id))!.Code);
        Assert.Null(NodePropertyValidator.Validate(Profile, "Button", "fontWeight", new NodeNumberValue(450)));
        Assert.NotNull(NodePropertyValidator.Validate(Profile, "Button", "fontWeight", new NodeNumberValue(450.5)));
    }

    [Fact]
    public void V4KeepsLegacySpacingAndGeometryReferencesAndValidatesBothThemes()
    {
        var space = new DesignToken(Guid.NewGuid(), "gap", TokenType.Spacing,
            Values(new LiteralTokenValue(new SpacingValue(8)), new LiteralTokenValue(new SpacingValue(16))));
        var radius = new DesignToken(Guid.NewGuid(), "radius", TokenType.Geometry,
            Values(new LiteralTokenValue(new GeometryValue(6)), new LiteralTokenValue(new GeometryValue(7))));
        var frame = new NodeStructure(Guid.NewGuid(), "Frame", [])
        {
            Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty
                .Add("gap", new NodeTokenValue(space.Id))
                .Add("cornerRadius", new NodeTokenValue(radius.Id))
        };
        var doc = Document(frame, space, radius);
        Assert.Empty(DocumentStructureValidator.Validate(doc, Installed));

        var invalid = doc with { Tokens = [space with
        {
            Values = Values(new LiteralTokenValue(new SpacingValue(8)), new LiteralTokenValue(new SpacingValue(-1)))
        }, radius] };
        Assert.Contains(DocumentStructureValidator.Validate(invalid, Installed),
            error => error.Property == "gap" && error.Code == "INVALID_PROPERTY_VALUE");
    }

    [Fact]
    public void NewTokenValueJsonRoundTripsWithStableDiscriminators()
    {
        TokenValue[] values = [new DimensionValue(12), new NumberValue(0.75),
            new FontFamilyValue("IBM Plex Sans"), new FontWeightValue(450)];
        foreach (var value in values)
            Assert.Equal(value, JsonSerializer.Deserialize<TokenValue>(JsonSerializer.Serialize<TokenValue>(value)));
        Assert.Contains("\"dimension\"", JsonSerializer.Serialize<TokenValue>(values[0]));
        Assert.Contains("\"fontWeight\"", JsonSerializer.Serialize<TokenValue>(values[3]));
    }

    [Fact]
    public async Task InvalidTokenUpdateIsAtomicAndPreservesExistingUsagesAndRevision()
    {
        var folder = Path.Combine(Path.GetTempPath(), "figvam-v4-tokens-" + Guid.NewGuid());
        try
        {
            var actor = new DocumentActor("owner"), id = Guid.NewGuid();
            var journal = new SqliteDocumentJournal(folder, Installed);
            var handler = new DocumentCommandHandler(journal, journal, Installed);
            Assert.True((await journal.CreateAsync(new(id), actor)).Accepted);
            var initial = (await journal.ReadAsync(id))!;
            Assert.Equal(PortableUiProfileReference.Version3, initial.Document.Profile);
            Assert.True((await handler.HandleAsync(new UpgradePortableUiProfileCommand(
                id, Guid.NewGuid(), initial.Revision), actor)).Accepted);
            var size = Dimension(TokenCategory.FontSize, 16, 20);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), size), actor)).Accepted);
            var pageId = Guid.NewGuid(); var screenId = Guid.NewGuid(); var nodeId = Guid.NewGuid();
            Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), pageId), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new AddScreenCommand(id, Guid.NewGuid(),
                pageId, screenId, new(800, 600)), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new AddNodeCommand(id, Guid.NewGuid(),
                screenId, nodeId, "Text", new Dictionary<string, NodePropertyValue>
                { ["fontSize"] = new NodeTokenValue(size.Id) }), actor)).Accepted);
            var before = (await journal.ReadAsync(id))!;
            var failed = await handler.HandleAsync(new SetTokenValueCommand(id, Guid.NewGuid(),
                size.Id, TokenTheme.Dark, new LiteralTokenValue(new DimensionValue(2000))), actor);
            Assert.Equal("INVALID_TOKEN", failed.Code);
            Assert.Equal(before.Revision, (await journal.ReadAsync(id))!.Revision);
            Assert.Equal(new NodeTokenValue(size.Id), (await journal.ReadAsync(id))!
                .Document.Nodes.Single().Properties["fontSize"]);
            var valid = await handler.HandleAsync(new SetTokenValueCommand(id, Guid.NewGuid(),
                size.Id, TokenTheme.Dark, new LiteralTokenValue(new DimensionValue(22))), actor);
            Assert.True(valid.Accepted);
            Assert.Equal(new DimensionValue(22),
                DesignTokenValidator.Resolve((await journal.ReadAsync(id))!.Document.Tokens, size.Id, TokenTheme.Dark).Value);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            Assert.Equal(new DimensionValue(20),
                DesignTokenValidator.Resolve((await journal.ReadAsync(id))!.Document.Tokens, size.Id, TokenTheme.Dark).Value);
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
}
