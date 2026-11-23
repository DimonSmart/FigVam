using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class DesignStage3Tests
{
    private static IReadOnlyDictionary<TokenTheme, TokenExpression> Both(TokenExpression light, TokenExpression? dark = null) =>
        new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = light, [TokenTheme.Dark] = dark ?? light };

    private static DesignToken Size(Guid id, string name = "font.size.body") =>
        new(id, name, TokenType.Dimension,
            Both(new LiteralTokenValue(new DimensionValue(18)), new LiteralTokenValue(new DimensionValue(20))),
            TokenCategory.FontSize);

    private static DesignToken Typography(Guid id, Guid sizeId) =>
        new(id, "typography.body", TokenType.Typography, Both(new LiteralTokenValue(
            new TypographyFieldsValue(new LiteralTokenValue(new FontFamilyValue("Arial")),
                new TokenAlias(sizeId), new LiteralTokenValue(new FontWeightValue(600)),
                new LiteralTokenValue(new NumberValue(1.4)),
                new LiteralTokenValue(new DimensionValue(-0.5))))));

    [Fact]
    public async Task DtcgRoundTripKeepsStableIdsNestedAliasesThemesAndTypography()
    {
        var dir = Path.Combine(Path.GetTempPath(), "figvam-stage3-" + Guid.NewGuid());
        try
        {
            var source = Guid.NewGuid(); var sizeId = Guid.NewGuid(); var typographyId = Guid.NewGuid();
            var auth = new DocumentActor("owner"); var journal = new SqliteDocumentJournal(dir, new EmptyNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new EmptyNodeProfile());
            await journal.CreateAsync(new(source), auth);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(source, Guid.NewGuid(), Size(sizeId)), auth)).Accepted);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(source, Guid.NewGuid(), Typography(typographyId, sizeId)), auth)).Accepted);
            var exporter = new DocumentTokenExporter(journal, journal);
            var light = (await exporter.ExportAsync(source, 2, TokenTheme.Light, auth)).Response!;
            var dark = (await exporter.ExportAsync(source, 2, TokenTheme.Dark, auth)).Response!;
            Assert.Empty(light.Diagnostics); Assert.Empty(dark.Diagnostics);
            Assert.Equal("{font.size.body}",
                light.Tokens!["typography"]!["body"]!["$value"]!["fontSize"]!.GetValue<string>());
            Assert.Equal(18d, light.Tokens!["font"]!["size"]!["body"]!["$value"]!["value"]!.GetValue<double>());
            Assert.Equal(20d, dark.Tokens!["font"]!["size"]!["body"]!["$value"]!["value"]!.GetValue<double>());

            var target = Guid.NewGuid(); await journal.CreateAsync(new(target), auth);
            var result = await handler.HandleAsync(new ImportDesignTokensCommand(target, Guid.NewGuid(), 0,
                light.Tokens.ToJsonString(), dark.Tokens!.ToJsonString(), new Dictionary<string, TokenType>()), auth);
            Assert.True(result.Accepted, string.Join("; ", result.Diagnostics?.Select(d => d.Message) ?? []));
            var imported = (await journal.ReadAsync(target))!.Document.Tokens;
            Assert.Equal(new[] { sizeId, typographyId }.Order(), imported.Select(t => t.Id).Order());
            var resolved = Assert.IsType<TypographyValue>(DesignTokenValidator.Resolve(imported, typographyId, TokenTheme.Light).Value);
            Assert.Equal(-0.5d, resolved.LetterSpacing);
            Assert.Equal(18d, resolved.FontSize);
            Assert.Equal(20d, Assert.IsType<TypographyValue>(DesignTokenValidator.Resolve(imported, typographyId, TokenTheme.Dark).Value).FontSize);
            Assert.Equal(result, await handler.HandleAsync(new ImportDesignTokensCommand(target, result.CommandId, 99,
                "bad", "bad", new Dictionary<string, TokenType>()), auth));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public async Task NestedStyleUsageBlocksTokenDeletionAndDoesNotChangeRevision()
    {
        var dir = Path.Combine(Path.GetTempPath(), "figvam-stage3-deps-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(dir, new VisualNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new VisualNodeProfile());
            await journal.CreateAsync(new(id), actor);
            var font = Size(Guid.NewGuid());
            var typography = Typography(Guid.NewGuid(), font.Id);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), font), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), typography), actor)).Accepted);
            var style = new DesignStyle(Guid.NewGuid(), "Typography / Body", DesignStyleType.TextStyle,
                new Dictionary<string, NodePropertyValue> { ["typography"] = new NodeTokenValue(typography.Id) });
            Assert.True((await handler.HandleAsync(new UpsertStyleCommand(id, Guid.NewGuid(), style, 2), actor)).Accepted);
            var graph = new DesignResourceDependencies((await journal.ReadAsync(id))!.Document);
            var uses = graph.Usages("token", font.Id);
            Assert.Contains(uses, x => x.Kind == "tokenTypographyField" && x.Property == "typography.fontSize");
            Assert.Contains(uses, x => x.Kind == "styleField" && x.Indirect &&
                x.Chain.SequenceEqual(new[] { font.Id, typography.Id, style.Id }));
            var result = await handler.HandleAsync(new DeleteTokenCommand(id, Guid.NewGuid(), font.Id, 3), actor);
            Assert.Equal("TOKEN_IN_USE", result.Code);
            Assert.Equal(3, (await journal.ReadAsync(id))!.Revision);
            var orphan = Size(Guid.NewGuid(), "font.size.unused");
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), orphan), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new DeleteTokenCommand(id, Guid.NewGuid(), orphan.Id, 4), actor)).Accepted);
            Assert.Equal(5, (await journal.ReadAsync(id))!.Revision);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            Assert.Contains((await journal.ReadAsync(id))!.Document.Tokens, token => token.Id == orphan.Id);
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void OptionalSpacingDeserializesOldTypographyAndValidatesNegativeRange()
    {
        var json = JsonSerializer.Serialize<TokenValue>(new TypographyValue("Arial", 16, 400, 1.25));
        var restored = Assert.IsType<TypographyValue>(JsonSerializer.Deserialize<TokenValue>(json));
        Assert.Equal(0d, restored.LetterSpacing);
        var token = new DesignToken(Guid.NewGuid(), "body", TokenType.Typography, Both(new LiteralTokenValue(restored)));
        Assert.Empty(DesignTokenValidator.Validate([token]));
        Assert.NotEmpty(DesignTokenValidator.Validate([token with { Values =
            Both(new LiteralTokenValue(restored with { LetterSpacing = -101 })) }]));
    }

    [Fact]
    public async Task CssUsesThemeValuesAndStableReferences()
    {
        var dir = Path.Combine(Path.GetTempPath(), "figvam-stage3-css-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(dir, new EmptyNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new EmptyNodeProfile());
            await journal.CreateAsync(new(id), actor);
            var size = Size(Guid.NewGuid()); var typography = Typography(Guid.NewGuid(), size.Id);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), size), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), typography), actor)).Accepted);
            var export = new DocumentResourceExporter(journal, journal, new EmptyNodeProfile());
            var result = (await export.ExportCssAsync(id, 2, actor)).Response!;
            Assert.Empty(result.Resources.Diagnostics);
            Assert.Contains("[data-figvam-theme=\"Dark\"]", result.Css);
            Assert.Contains("--figvam-" + size.Id.ToString("N") + ": 18px;", result.Css);
            Assert.Contains("--figvam-" + size.Id.ToString("N") + ": 20px;", result.Css);
            Assert.Contains("var(--figvam-" + size.Id.ToString("N") + ")", result.Css);
            Assert.Equal(result.Css, (await export.ExportCssAsync(id, 2, actor)).Response!.Css);
        }
        finally { Directory.Delete(dir, true); }
    }
}
