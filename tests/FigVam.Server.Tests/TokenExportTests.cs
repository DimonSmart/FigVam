using FigVam.Application.Documents;
using FigVam.Domain.Tokens;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;

namespace FigVam.Server.Tests;

public sealed class TokenExportTests
{
    [Fact]
    public async Task ExportsSelectedRevisionAndThemeDeterministicallyWithAliasesAndPermissionChecks()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-export-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(id), owner);
            await journal.SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
            var exporter = new DocumentTokenExporter(journal, journal);
            DesignToken Make(string name, TokenType type, TokenExpression light, TokenExpression dark) => new(Guid.NewGuid(), name, type, new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = light, [TokenTheme.Dark] = dark });
            var space = Make("space", TokenType.Spacing, new LiteralTokenValue(new SpacingValue(8)), new LiteralTokenValue(new SpacingValue(12)));
            var color = Make("color", TokenType.Color, new LiteralTokenValue(new ColorValue(255, 0, 0, 128)), new LiteralTokenValue(new ColorValue(0, 0, 0)));
            var radius = Make("radius", TokenType.Geometry, new LiteralTokenValue(new GeometryValue(4)), new LiteralTokenValue(new GeometryValue(6)));
            var alias = Make("alias", TokenType.Spacing, new TokenAlias(space.Id), new TokenAlias(space.Id));
            foreach (var token in new[] { space, color, radius, alias }) Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), token), owner)).Accepted);
            var light = (await exporter.ExportAsync(id, 4, TokenTheme.Light, owner)).Response!;
            Assert.Equal(4, light.Revision); Assert.Empty(light.Diagnostics);
            Assert.Equal("{space}", light.Tokens!["alias"]!["$value"]!.GetValue<string>());
            Assert.Equal(8, light.Tokens["space"]!["$value"]!["value"]!.GetValue<double>());
            Assert.Equal("srgb", light.Tokens["color"]!["$value"]!["colorSpace"]!.GetValue<string>());
            Assert.Equal(4, light.Tokens["radius"]!["$value"]!["value"]!.GetValue<double>());
            Assert.Equal(light.Tokens.ToJsonString(), (await exporter.ExportAsync(id, 4, TokenTheme.Light, owner)).Response!.Tokens!.ToJsonString());
            Assert.Equal(12, (await exporter.ExportAsync(id, 4, TokenTheme.Dark, owner)).Response!.Tokens!["space"]!["$value"]!["value"]!.GetValue<double>());
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, null, TokenTheme.Light, new("viewer"))).Code);
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, null, TokenTheme.Light, new("outsider"))).Code);
            Assert.True((await handler.HandleAsync(new RenameTokenCommand(id, Guid.NewGuid(), space.Id, "new.space"), owner)).Accepted);
            var unsupported = (await exporter.ExportAsync(id, null, TokenTheme.Light, owner)).Response!;
            Assert.Null(unsupported.Tokens); Assert.Contains(unsupported.Diagnostics, d => d.Code == "unsupported-name");
            Assert.NotNull((await exporter.ExportAsync(id, 4, TokenTheme.Light, owner)).Response!.Tokens);
            var typography = Make("type", TokenType.Typography, new LiteralTokenValue(new TypographyValue("Arial", 12, 400, 1.2)), new LiteralTokenValue(new TypographyValue("Arial", 12, 400, 1.2)));
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), typography), owner)).Accepted);
            Assert.Contains((await exporter.ExportAsync(id, null, TokenTheme.Dark, owner)).Response!.Diagnostics, d => d.Code == "unsupported-typography");
        }
        finally { Directory.Delete(directory, true); }
    }
}

public sealed class TokenExportInvalidTests
{
    private sealed class Auth : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
    }
    private sealed class Reader(FigVam.Domain.Documents.DocumentStructure document) : IDocumentStateReader
    {
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default) => Task.FromResult(new DocumentStateReadResult("OK", new(document, 7)));
    }
    [Fact]
    public async Task RejectsAmbiguousNamesAndInvalidAliasesWithoutPartialOutput()
    {
        var id = Guid.NewGuid(); var a = Guid.NewGuid(); var b = Guid.NewGuid();
        DesignToken Make(Guid tokenId, Guid target) => new(tokenId, "duplicate", TokenType.Spacing, new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = new TokenAlias(target), [TokenTheme.Dark] = new TokenAlias(target) });
        var doc = new FigVam.Domain.Documents.DocumentStructure(id, [], [], []) { Tokens = [Make(a, b), Make(b, a)] };
        var response = (await new DocumentTokenExporter(new Auth(), new Reader(doc)).ExportAsync(id, null, TokenTheme.Light, new("owner"))).Response!;
        Assert.Null(response.Tokens);
        Assert.Contains(response.Diagnostics, x => x.Code == "duplicate-name");
        Assert.Contains(response.Diagnostics, x => x.Code == "alias-cycle");
    }
}
