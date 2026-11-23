using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class TokenImportTests
{
    private const string Light = """{"color":{"$type":"color","$value":{"colorSpace":"srgb","components":[1,0,0],"alpha":1}},"space":{"$type":"dimension","$value":{"value":8,"unit":"px"}},"radius":{"$type":"dimension","$value":{"value":4,"unit":"px"}},"alias":{"$type":"dimension","$value":"{space}"}}""";
    private const string Dark = """{"color":{"$type":"color","$value":{"colorSpace":"srgb","components":[0,0,1],"alpha":1}},"space":{"$type":"dimension","$value":{"value":12,"unit":"px"}},"radius":{"$type":"dimension","$value":{"value":6,"unit":"px"}},"alias":{"$type":"dimension","$value":"{space}"}}""";
    private static Dictionary<string, TokenType> Mapping() => new() { ["space"] = TokenType.Spacing, ["alias"] = TokenType.Spacing, ["radius"] = TokenType.Geometry };
    private static ImportDesignTokensCommand Command(Guid id, long revision = 0) => new(id, Guid.NewGuid(), revision, Light, Dark, Mapping());

    [Fact]
    public async Task AtomicImportRoundTripsThemesAliasesAndRecoversSafeHistory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-import-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            SqliteDocumentJournal Journal() => new(directory, new EmptyNodeProfile());
            DocumentCommandHandler Handler() { var j = Journal(); return new(j, j, new EmptyNodeProfile()); }
            await Journal().CreateAsync(new(id), owner); await Journal().SetMemberAsync(id, editor.Id, DocumentRole.Editor, owner);
            var command = Command(id); var result = await Handler().HandleAsync(command, owner);
            Assert.True(result.Accepted); Assert.Equal(1, result.Revision); Assert.Equal(4, result.AffectedIds!.Count);
            Assert.Equal(result, await Handler().HandleAsync(command with { LightJson = "invalid", ExpectedRevision = 99 }, owner));
            var state = (await Journal().ReadAsync(id))!;
            Assert.Equal(4, state.Document.Tokens.Count);
            Assert.Equal(new SpacingValue(8), DesignTokenValidator.Resolve(state.Document.Tokens, state.Document.Tokens.Single(t => t.Name == "alias").Id, TokenTheme.Light).Value);
            Assert.Equal(new SpacingValue(12), DesignTokenValidator.Resolve(state.Document.Tokens, state.Document.Tokens.Single(t => t.Name == "alias").Id, TokenTheme.Dark).Value);
            Assert.IsType<TokensImported>(Assert.Single((await Journal().ReadEventsAsync(id, 0)).Events!).Payload);
            foreach (var theme in Enum.GetValues<TokenTheme>())
            {
                var j = Journal(); var export = await new DocumentTokenExporter(j, j).ExportAsync(id, 1, theme, owner);
                Assert.Empty(export.Response!.Diagnostics);
                Assert.Equal("{space}", export.Response.Tokens!["alias"]!["$value"]!.GetValue<string>());
                Assert.Equal(theme == TokenTheme.Light ? 8d : 12d, export.Response.Tokens!["space"]!["$value"]!["value"]!.GetValue<double>());
                Assert.Equal(expected: state.Document.Tokens.Single(t => t.Name == "space").Id.ToString("D"),
                    actual: export.Response.Tokens!["space"]!["$extensions"]!["org.figvam"]!["id"]!.GetValue<string>());
            }
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.Empty((await Journal().ReadAsync(id))!.Document.Tokens);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            var target = state.Document.Tokens.Single(t => t.Name == "space").Id;
            var dependent = new DesignToken(Guid.NewGuid(), "dependent", TokenType.Spacing, new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = new TokenAlias(target), [TokenTheme.Dark] = new TokenAlias(target) });
            Assert.True((await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), dependent), editor)).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Code);
            for (var i = 0; i < 30; i++) await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), editor);
            var recovered = (await Journal().ReadAsync(id))!;
            Assert.Equal(34, recovered.Revision); Assert.Equal(5, recovered.Document.Tokens.Count);
            Assert.Equal(result, await Handler().HandleAsync(command, owner));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task InvalidImportsAndRightsNeverChangeRevisionAndReturnDiagnostics()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-import-invalid-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var j = new SqliteDocumentJournal(directory, new EmptyNodeProfile()); var h = new DocumentCommandHandler(j, j, new EmptyNodeProfile());
            await j.CreateAsync(new(id), owner); await j.SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
            var command = Command(id);
            var cases = new (ImportDesignTokensCommand Command, string Code)[]
            {
                (command with { DimensionTypes = new Dictionary<string, TokenType>() }, "dimension-type-required"),
                (command with { DimensionTypes = new Dictionary<string, TokenType> { [new string('x', 257)] = TokenType.Spacing } }, "invalid-dimension-mapping"),
                (command with { DarkJson = "{}" }, "incomplete-theme"),
                (command with { LightJson = "{\"" + new string('x', 257) + "\":{\"$type\":\"color\",\"$value\":{}}}" }, "unsupported-name"),
                (command with { DarkJson = Dark.Replace("\"radius\":{\"$type\":\"dimension\"", "\"radius\":{\"$type\":\"color\"") }, "type-mismatch"),
                (command with { LightJson = "{" + string.Join(",", Enumerable.Range(0, 1001).Select(i => "\"c" + i + "\":{\"$type\":\"color\",\"$value\":{}}")) + "}" }, "import-limit"),
                (command with { LightJson = Light.Replace("{space}", "{missing}") }, "missing-reference"),
                (command with { LightJson = Light.Replace("{space}", "{alias}") }, "alias-cycle"),
                (command with { LightJson = Light.Replace("{space}", "{color}") }, "type-mismatch"),
                (command with { LightJson = Light.Replace("\"value\":4", "\"value\":-4") }, "type-mismatch"),
                (command with { LightJson = Light.Replace("\"px\"", "\"rem\"") }, "unsupported-value"),
                (command with { LightJson = Light.Replace("[1,0,0]", "[0.5,0,0]") }, "unsupported-color"),
                (command with { LightJson = """{"group":{"$extends":"{other}","token":{"$type":"number","$value":1}}}""" }, "unsupported-construct"),
                (command with { LightJson = """{"type":{"$type":"typography","$value":{}}}""" }, "unsupported-value"),
                (command with { LightJson = """{"x":{"$type":"dimension","$value":1,"$value":2}}""" }, "unsupported-construct"),
                (command with { LightJson = """{"x":{"$type":"color","$value":{}},"x":{"$type":"color","$value":{}}}""" }, "duplicate-name"),
                (command with { LightJson = new string(' ', 1048577) }, "import-limit"),
                (command with { LightJson = "[[[[[[[[[[]]]]]]]]]]" }, "invalid-json")
            };
            foreach (var test in cases)
            {
                var result = await h.HandleAsync(test.Command with { CommandId = Guid.NewGuid() }, owner);
                Assert.Equal("INVALID_TOKEN_IMPORT", result.Code); Assert.Contains(result.Diagnostics!, d => d.Code == test.Code);
                Assert.All(result.Diagnostics!, d => { Assert.False(string.IsNullOrWhiteSpace(d.Path)); Assert.True(d.Path.Length <= 300); });
                Assert.Equal(0, (await j.ReadAsync(id))!.Revision); Assert.Empty((await j.ReadAsync(id))!.Document.Tokens);
            }
            Assert.Equal("FORBIDDEN", (await h.HandleAsync(command, new("viewer"))).Code);
            Assert.Equal("FORBIDDEN", (await h.HandleAsync(command, new("outsider"))).Code);
            Assert.True((await h.HandleAsync(command, owner)).Accepted);
            var conflictCommand = Command(id, 1);
            var conflict = await h.HandleAsync(conflictCommand, owner); Assert.Contains(conflict.Diagnostics!, d => d.Code == "name-conflict");
            Assert.Equal(conflict, await h.HandleAsync(conflictCommand with { LightJson = "{}" }, owner));
            Assert.Equal("REVISION_CONFLICT", (await h.HandleAsync(Command(id), owner)).Code);
            Assert.Equal("FORBIDDEN", (await h.HandleAsync(command, new("viewer"))).Code);
            Assert.Equal(1, (await j.ReadAsync(id))!.Revision); Assert.Single((await j.ReadHistoryAsync(id, owner.Id)).Entries!);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task PublicApiPublishesSchemaDiagnosticsAuthorizationAndIdempotency()
    {
        using var key = RSA.Create(2048); var config = ServerTestIdentity.Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-import-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        var id = Guid.NewGuid(); var payload = new ImportDesignTokensRequest { CommandId = Guid.NewGuid(), ExpectedRevision = 0, LightJson = Light, DarkJson = Dark, DimensionTypes = Mapping() };
        var route = $"/api/v1/documents/{id}/commands/import-design-tokens";
        try
        {
            await using (var server = new ServerProcess(config))
            {
                await server.WaitUntilReadyAsync(); using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
                Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
                using var schemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/ImportDesignTokensRequest.json")); var schema = JsonSchema.Build(schemaDoc.RootElement.Clone());
                Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid); Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
                Assert.Contains("import-design-tokens", await client.GetStringAsync("/openapi/v1.json"));
                using var bad = await client.PostAsJsonAsync(route, new { commandId = Guid.NewGuid(), expectedRevision = 0, lightJson = Light, darkJson = "{}", dimensionTypes = Mapping() });
                Assert.Equal(400, (int)bad.StatusCode); Assert.Contains((await bad.Content.ReadFromJsonAsync<ApiError>())!.Diagnostics!, d => d.Code == "incomplete-theme");
                using var response = await client.PostAsJsonAsync(route, payload); Assert.Equal(200, (int)response.StatusCode); Assert.Equal(4, (await response.Content.ReadFromJsonAsync<CommandResponse>())!.AffectedIds.Count);
                await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
                client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer")); Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            }
            await using (var server = new ServerProcess(config))
            {
                await server.WaitUntilReadyAsync(); using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
                using var response = await client.PostAsJsonAsync(route, payload); Assert.Equal(200, (int)response.StatusCode); Assert.Equal(1, (await response.Content.ReadFromJsonAsync<CommandResponse>())!.Revision);
                foreach (var theme in new[] { "Light", "Dark" }) Assert.Equal(200, (int)(await client.GetAsync($"/api/v1/documents/{id}/token-export?theme={theme}")).StatusCode);
            }
        }
        finally { Directory.Delete(directory, true); }
    }
}

