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
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class TokenCommandTests
{
    private sealed class TokenProfile : INodeProfile
    {
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => kind == "test" && property == "space" ? new(NodePropertyType.TokenReference, TokenType: TokenType.Spacing) : null;
    }

    private static DesignToken Token(Guid? id = null, TokenExpression? expression = null) => new(id ?? Guid.NewGuid(), "space", TokenType.Spacing,
        new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = expression ?? new LiteralTokenValue(new SpacingValue(8)), [TokenTheme.Dark] = expression ?? new LiteralTokenValue(new SpacingValue(12)) });

    [Fact]
    public async Task TokensSurviveJournalSnapshotsVersionsAndSafeHistory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner"); var other = new DocumentActor("editor");
            SqliteDocumentJournal Journal() => new(directory, new UnverifiedNodeProfile());
            DocumentCommandHandler Handler() { var journal = Journal(); return new(journal, journal, new UnverifiedNodeProfile()); }
            await Journal().CreateAsync(new(id), actor);
            await Journal().SetMemberAsync(id, other.Id, DocumentRole.Editor, actor);
            var token = Token(); var command = new AddTokenCommand(id, Guid.NewGuid(), token);
            var result = await Handler().HandleAsync(command, actor);
            Assert.True(result.Accepted);
            Assert.Equal(result, await Handler().HandleAsync(command with { Token = Token() }, actor));
            Assert.IsType<TokenAdded>(Assert.Single((await Journal().ReadEventsAsync(id, 0)).Events!).Payload);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            Assert.Empty((await Journal().ReadAsync(id))!.Document.Tokens);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            var alias = Token(expression: new TokenAlias(token.Id));
            Assert.True((await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), alias), other)).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Code);
            var save = await Handler().HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "tokens"), actor);
            for (var i = 0; i < 30; i++) Assert.True((await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), Token()), other)).Accepted);
            var recovered = (await Journal().ReadAsync(id))!;
            Assert.Equal(35, recovered.Revision);
            Assert.Equal(32, recovered.Document.Tokens.Count);
            var saved = await Journal().ReadVersionAsync(id, save.VersionId!.Value);
            Assert.Equal(2, saved.Version!.Snapshot.Document.Tokens.Count);
            Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), save.VersionId.Value), actor)).Accepted);
            Assert.Equal(2, (await Journal().ReadAsync(id))!.Document.Tokens.Count);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            Assert.Equal(32, (await Journal().ReadAsync(id))!.Document.Tokens.Count);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task InvalidTokensAndUnauthorizedRetriesDoNotChangeRevision()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner"); var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(id), actor);
            await journal.SetMemberAsync(id, "viewer", DocumentRole.Viewer, actor);
            var token = Token(); var command = new AddTokenCommand(id, Guid.NewGuid(), token);
            var original = await handler.HandleAsync(command, actor);
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(command, new("viewer"))).Code);
            var invalid = new[] { Token(id), token, Token() with { Type = (TokenType)99 }, Token(expression: new LiteralTokenValue(new ColorValue(1,2,3))), Token(expression: new TokenAlias(Guid.NewGuid())), Token() with { Values = new Dictionary<TokenTheme, TokenExpression>() }, Token() with { Name = "" }, Token(expression: new LiteralTokenValue(new SpacingValue(double.NaN))) };
            foreach (var bad in invalid) Assert.False((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), bad), actor)).Accepted);
            var cycle = Token(); cycle = cycle with { Values = new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = new TokenAlias(cycle.Id), [TokenTheme.Dark] = new TokenAlias(cycle.Id) } };
            Assert.Equal("INVALID_TOKEN", (await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), cycle), actor)).Code);
            Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), token.Id), actor)).Code);
            Assert.Equal(original, await handler.HandleAsync(command, actor));
            Assert.Equal(1, (await journal.ReadAsync(id))!.Revision);
            Assert.Single((await journal.ReadAsync(id))!.Document.Tokens);
            Assert.Single((await journal.ReadHistoryAsync(id, actor.Id)).Entries!);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task UndoPreservesAnotherEditorsNodeReference()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(directory, new TokenProfile());
            var handler = new DocumentCommandHandler(journal, journal, new TokenProfile());
            await journal.CreateAsync(new(id), actor);
            await journal.SetMemberAsync(id, "editor", DocumentRole.Editor, actor);
            var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid();
            await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), page), actor);
            await handler.HandleAsync(new AddScreenCommand(id, Guid.NewGuid(), page, screen), actor);
            await handler.HandleAsync(new AddNodeCommand(id, Guid.NewGuid(), screen, node, "test"), actor);
            var token = Token();
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), token), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new SetNodePropertyCommand(id, Guid.NewGuid(), node, "space", new NodeTokenValue(token.Id)), new("editor"))).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Code);
            Assert.Equal(5, (await journal.ReadAsync(id))!.Revision);
            Assert.Single((await journal.ReadAsync(id))!.Document.Tokens);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task RedoCannotReuseAnIdClaimedByAnotherEditor()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var actor = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(id), actor);
            await journal.SetMemberAsync(id, "editor", DocumentRole.Editor, actor);
            var token = Token();
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), token), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor)).Accepted);
            Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), token.Id), new("editor"))).Accepted);
            Assert.Equal("REDO_NOT_APPLICABLE", (await handler.HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), actor)).Code);
            var state = (await journal.ReadAsync(id))!;
            Assert.Equal(3, state.Revision); Assert.Empty(state.Document.Tokens); Assert.Equal(token.Id, Assert.Single(state.Document.Pages).Id);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task RenamePreservesReferencesAndGuardsHistoryAcrossRecovery()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-rename-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            SqliteDocumentJournal Journal() => new(directory, new TokenProfile());
            DocumentCommandHandler Handler() { var journal = Journal(); return new(journal, journal, new TokenProfile()); }
            await Journal().CreateAsync(new(id), owner);
            await Journal().SetMemberAsync(id, editor.Id, DocumentRole.Editor, owner);
            await Journal().SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
            var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid();
            await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), page), owner);
            await Handler().HandleAsync(new AddScreenCommand(id, Guid.NewGuid(), page, screen), owner);
            await Handler().HandleAsync(new AddNodeCommand(id, Guid.NewGuid(), screen, node, "test"), owner);
            var token = Token(); var alias = Token(expression: new TokenAlias(token.Id));
            await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), token), owner);
            await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), alias), editor);
            await Handler().HandleAsync(new SetNodePropertyCommand(id, Guid.NewGuid(), node, "space", new NodeTokenValue(token.Id)), editor);
            var rename = new RenameTokenCommand(id, Guid.NewGuid(), token.Id, "renamed");
            var result = await Handler().HandleAsync(rename, owner);
            Assert.True(result.Accepted);
            Assert.Equal(result, await Handler().HandleAsync(rename with { Name = "ignored" }, owner));
            Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(rename, new("viewer"))).Code);
            Assert.Equal("TOKEN_NOT_FOUND", (await Handler().HandleAsync(rename with { CommandId = Guid.NewGuid(), TokenId = Guid.NewGuid() }, owner)).Code);
            Assert.Equal("INVALID_ID", (await Handler().HandleAsync(rename with { CommandId = Guid.NewGuid(), TokenId = Guid.Empty }, owner)).Code);
            Assert.Equal("INVALID_TOKEN", (await Handler().HandleAsync(rename with { CommandId = Guid.NewGuid(), Name = "bad\nname" }, owner)).Code);
            var state = (await Journal().ReadAsync(id))!;
            Assert.Equal(result.Revision, state.Revision);
            Assert.Equal("renamed", state.Document.Tokens.Single(t => t.Id == token.Id).Name);
            Assert.Equal(new TokenAlias(token.Id), state.Document.Tokens.Single(t => t.Id == alias.Id).Values[TokenTheme.Light]);
            Assert.Equal(new NodeTokenValue(token.Id), Assert.Single(state.Document.Nodes).Properties["space"]);
            Assert.Equal(new SpacingValue(8), DesignTokenValidator.Resolve(state.Document.Tokens, alias.Id, TokenTheme.Light).Value);
            Assert.IsType<TokenRenamed>((await Journal().ReadEventsAsync(id, result.Revision!.Value - 1)).Events!.Single().Payload);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal("space", (await Journal().ReadAsync(id))!.Document.Tokens.Single(t => t.Id == token.Id).Name);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.True((await Handler().HandleAsync(new RenameTokenCommand(id, Guid.NewGuid(), token.Id, "other"), editor)).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Code);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), editor)).Accepted);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.True((await Handler().HandleAsync(new RenameTokenCommand(id, Guid.NewGuid(), token.Id, "conflict"), editor)).Accepted);
            Assert.Equal("REDO_NOT_APPLICABLE", (await Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Code);
            Assert.Equal("conflict", (await Journal().ReadAsync(id))!.Document.Tokens.Single(t => t.Id == token.Id).Name);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task SetThemeValueValidatesAndRecoversWithSafeHistory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-value-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            SqliteDocumentJournal Journal() => new(directory, new UnverifiedNodeProfile());
            DocumentCommandHandler Handler() { var j = Journal(); return new(j, j, new UnverifiedNodeProfile()); }
            await Journal().CreateAsync(new(id), owner);
            await Journal().SetMemberAsync(id, editor.Id, DocumentRole.Editor, owner);
            await Journal().SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
            var target = Token(); var alias = Token(expression: new TokenAlias(target.Id));
            Assert.True((await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), target), owner)).Accepted);
            Assert.True((await Handler().HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), alias), editor)).Accepted);
            var command = new SetTokenValueCommand(id, Guid.NewGuid(), target.Id, TokenTheme.Light, new LiteralTokenValue(new SpacingValue(20)));
            var accepted = await Handler().HandleAsync(command, owner);
            Assert.True(accepted.Accepted);
            Assert.Equal(accepted, await Handler().HandleAsync(command with { Value = new LiteralTokenValue(new SpacingValue(99)) }, owner));
            Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(command, new("viewer"))).Code);
            foreach (var bad in new TokenExpression[] { new TokenAlias(Guid.NewGuid()), new TokenAlias(alias.Id), new LiteralTokenValue(new ColorValue(0, 0, 0)), new LiteralTokenValue(new SpacingValue(double.NaN)) })
                Assert.Equal("INVALID_TOKEN", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Value = bad }, owner)).Code);
            Assert.Equal("INVALID_TOKEN", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Theme = (TokenTheme)99 }, owner)).Code);
            Assert.Equal("TOKEN_NOT_FOUND", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), TokenId = Guid.NewGuid() }, owner)).Code);
            var state = (await Journal().ReadAsync(id))!;
            Assert.Equal(accepted.Revision, state.Revision);
            Assert.Equal(new SpacingValue(20), DesignTokenValidator.Resolve(state.Document.Tokens, alias.Id, TokenTheme.Light).Value);
            Assert.Equal(new SpacingValue(12), DesignTokenValidator.Resolve(state.Document.Tokens, alias.Id, TokenTheme.Dark).Value);
            Assert.IsType<TokenValueSet>(Assert.Single((await Journal().ReadEventsAsync(id, accepted.Revision!.Value - 1)).Events!).Payload);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal(new SpacingValue(8), DesignTokenValidator.Resolve((await Journal().ReadAsync(id))!.Document.Tokens, alias.Id, TokenTheme.Light).Value);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.True((await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Value = new LiteralTokenValue(new SpacingValue(30)) }, editor)).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Code);
            Assert.True((await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Value = new LiteralTokenValue(new SpacingValue(9)), TokenId = alias.Id, Theme = TokenTheme.Dark }, editor)).Accepted);
            Assert.True((await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Value = new TokenAlias(target.Id), TokenId = alias.Id, Theme = TokenTheme.Dark }, editor)).Accepted);
            Assert.Equal(new SpacingValue(12), DesignTokenValidator.Resolve((await Journal().ReadAsync(id))!.Document.Tokens, alias.Id, TokenTheme.Dark).Value);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task RedoRejectsAliasCycleIntroducedByAnotherEditor()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-redo-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(id), owner);
            await journal.SetMemberAsync(id, editor.Id, DocumentRole.Editor, owner);
            var first = Token(); var second = Token();
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), first), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new AddTokenCommand(id, Guid.NewGuid(), second), editor)).Accepted);
            Assert.True((await handler.HandleAsync(new SetTokenValueCommand(id, Guid.NewGuid(), first.Id, TokenTheme.Light, new TokenAlias(second.Id)), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new SetTokenValueCommand(id, Guid.NewGuid(), second.Id, TokenTheme.Light, new TokenAlias(first.Id)), editor)).Accepted);
            var before = (await journal.ReadAsync(id))!;
            Assert.Equal("REDO_NOT_APPLICABLE", (await handler.HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Code);
            var after = (await new SqliteDocumentJournal(directory, new UnverifiedNodeProfile()).ReadAsync(id))!;
            Assert.Equal(before.Revision, after.Revision);
            Assert.Equal(new SpacingValue(8), DesignTokenValidator.Resolve(after.Document.Tokens, second.Id, TokenTheme.Light).Value);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task PublicTokenCommandHasValidatedSchemaAndSurvivesServerRestart()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-token-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        var id = Guid.NewGuid(); var commandId = Guid.NewGuid(); var tokenId = Guid.NewGuid();
        var payload = new { commandId, tokenId, name = "space", type = 1, values = new { Light = new { expression = "literal", value = new { type = "spacing", value = 8 } }, Dark = new { expression = "literal", value = new { type = "spacing", value = 12 } } } };
        var setPayload = new { commandId = Guid.NewGuid(), tokenId, theme = 1, value = new { expression = "literal", value = new { type = "spacing", value = 24 } } };
        try
        {
            await using (var server = new ServerProcess(config))
            {
                await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
                client.DefaultRequestHeaders.Authorization = new("Bearer", TokenForOwner());
                Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
                var route = $"/api/v1/documents/{id}/commands/add-token";
                using var response = await client.PostAsJsonAsync(route, payload);
                Assert.Equal(200, (int)response.StatusCode);
                Assert.Equal(tokenId, Assert.Single((await response.Content.ReadFromJsonAsync<CommandResponse>())!.AffectedIds));
                using var duplicate = await client.PostAsJsonAsync(route, payload);
                Assert.Equal(1, (await duplicate.Content.ReadFromJsonAsync<CommandResponse>())!.Revision);
                using var schemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddTokenRequest.json"));
                var schema = JsonSchema.Build(schemaDoc.RootElement.Clone());
                Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
                Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
                using var invalid = await client.PostAsJsonAsync(route, new { commandId = Guid.NewGuid(), tokenId = Guid.NewGuid(), name = "bad", type = 1, values = new { } });
                Assert.Equal(400, (int)invalid.StatusCode);
                Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", TokenForOwner());
                var renamePayload = new { commandId = Guid.NewGuid(), tokenId, name = "renamed" };
                var renameRoute = $"/api/v1/documents/{id}/commands/rename-token";
                using var renameResponse = await client.PostAsJsonAsync(renameRoute, renamePayload);
                Assert.Equal(200, (int)renameResponse.StatusCode);
                Assert.Equal(tokenId, Assert.Single((await renameResponse.Content.ReadFromJsonAsync<CommandResponse>())!.AffectedIds));
                using var renameSchemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/RenameTokenRequest.json"));
                var renameSchema = JsonSchema.Build(renameSchemaDoc.RootElement.Clone());
                Assert.True(renameSchema.EvaluateNode(JsonSerializer.SerializeToNode(renamePayload)!).IsValid);
                Assert.False(renameSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
                Assert.Contains("rename-token", await client.GetStringAsync("/openapi/v1.json"));
                using var missingRename = await client.PostAsJsonAsync(renameRoute, new { commandId = Guid.NewGuid(), tokenId = Guid.NewGuid(), name = "missing" });
                Assert.Equal(404, (int)missingRename.StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(renameRoute, renamePayload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", TokenForOwner());
                var setRoute = $"/api/v1/documents/{id}/commands/set-token-value";
                using var setResponse = await client.PostAsJsonAsync(setRoute, setPayload);
                Assert.Equal(200, (int)setResponse.StatusCode);
                using var setSchemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/SetTokenValueRequest.json"));
                var setSchema = JsonSchema.Build(setSchemaDoc.RootElement.Clone());
                Assert.True(setSchema.EvaluateNode(JsonSerializer.SerializeToNode(setPayload)!).IsValid);
                Assert.False(setSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
                Assert.Contains("set-token-value", await client.GetStringAsync("/openapi/v1.json"));
                Assert.Equal(400, (int)(await client.PostAsJsonAsync(setRoute, new { commandId = Guid.NewGuid(), tokenId, theme = 1, value = new { expression = "alias", tokenId = Guid.NewGuid() } })).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(setRoute, setPayload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", TokenForOwner());
                var snapshotSchema = await client.GetStringAsync("/api/v1/schemas/DocumentStructure.json");
                Assert.Contains("tokens", snapshotSchema);
            }
            await using (var restarted = new ServerProcess(config))
            {
                await restarted.WaitUntilReadyAsync(); using var client = restarted.CreateClient();
                client.DefaultRequestHeaders.Authorization = new("Bearer", TokenForOwner());
                using var retry = await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/add-token", payload);
                Assert.Equal(200, (int)retry.StatusCode);
                Assert.Equal(1, (await retry.Content.ReadFromJsonAsync<CommandResponse>())!.Revision);
                using var setRetry = await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/set-token-value", setPayload);
                Assert.Equal(200, (int)setRetry.StatusCode);
                Assert.Equal(3, (await setRetry.Content.ReadFromJsonAsync<CommandResponse>())!.Revision);
                var state = (await new SqliteDocumentJournal(directory, new UnverifiedNodeProfile()).ReadAsync(id))!;
                Assert.Equal("renamed", Assert.Single(state.Document.Tokens).Name);
                Assert.Equal(new SpacingValue(24), DesignTokenValidator.Resolve(state.Document.Tokens, tokenId, TokenTheme.Dark).Value);
            }
        }
        finally { Directory.Delete(directory, true); }
        string TokenForOwner() => ServerTestIdentity.Token(key, subject: "owner");
    }
}
