using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Tokens;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class TokenQueryTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    [Fact]
    public async Task FindsDirectComponentReferencesAtTheRequestedRevisionInStablePages()
    {
        var doc = Guid.NewGuid(); var tokenId = Guid.NewGuid(); var otherTokenId = Guid.NewGuid();
        var definitionId = Guid.NewGuid(); var variantId = Guid.NewGuid(); var instanceId = Guid.NewGuid();
        var firstParameter = Guid.NewGuid(); var secondParameter = Guid.NewGuid();
        var target = new DesignToken(tokenId, "space", TokenType.Spacing, new Dictionary<TokenTheme, TokenExpression>
        {
            [TokenTheme.Light] = new LiteralTokenValue(new SpacingValue(8)),
            [TokenTheme.Dark] = new LiteralTokenValue(new SpacingValue(8))
        });
        var parameters = new[]
        {
            new ComponentParameter(firstParameter, "first", ComponentParameterType.TokenReference, new ComponentToken(tokenId), TokenType.Spacing),
            new ComponentParameter(secondParameter, "second", ComponentParameterType.TokenReference, new ComponentToken(tokenId), TokenType.Spacing)
        };
        var variant = new ComponentVariant(variantId, "hover", ComponentVariantKind.Hover, null,
            new Dictionary<Guid, ComponentValue> { [firstParameter] = new ComponentToken(tokenId), [secondParameter] = new ComponentToken(otherTokenId) });
        var definition = new ComponentDefinition(definitionId, "component", "", Guid.NewGuid(), parameters, [], [variant]);
        var instance = new ComponentInstance(instanceId, definitionId, variantId,
            new Dictionary<Guid, ComponentValue> { [firstParameter] = new ComponentToken(tokenId), [secondParameter] = new ComponentToken(tokenId) },
            new Dictionary<Guid, IReadOnlyList<Guid>>());
        var historical = new DocumentStructure(doc, [], [], []) { Tokens = [target], ComponentDefinitions = [definition with { Variants = [] }] };
        var current = historical with { ComponentDefinitions = [definition], ComponentInstances = [instance] };
        var reader = new Reader(current, historical); var service = new DocumentTokenQueries(new Access(), reader); var actor = new DocumentActor("reader");
        var all = (await service.UsagesAsync(doc, tokenId, null, 0, 100, actor)).Response!;
        Assert.Equal(5, all.Total);
        Assert.Contains(all.Items, u => u.Kind == "componentParameterDefault" && u.OwnerId == definitionId && u.ParameterId == firstParameter);
        Assert.Contains(all.Items, u => u.Kind == "componentParameterDefault" && u.OwnerId == definitionId && u.ParameterId == secondParameter);
        Assert.Contains(all.Items, u => u.Kind == "componentVariantParameterChange" && u.OwnerId == variantId && u.ParameterId == firstParameter);
        Assert.Contains(all.Items, u => u.Kind == "componentInstanceParameterOverride" && u.OwnerId == instanceId && u.ParameterId == firstParameter);
        Assert.Contains(all.Items, u => u.Kind == "componentInstanceParameterOverride" && u.OwnerId == instanceId && u.ParameterId == secondParameter);
        var paged = new List<TokenUsage>();
        for (var offset = 0; offset < all.Total; offset += 2)
        {
            var page = (await service.UsagesAsync(doc, tokenId, null, offset, 2, actor)).Response!;
            Assert.Equal(all.Total, page.Total); paged.AddRange(page.Items);
        }
        Assert.Equal(all.Items, paged);
        var old = (await service.UsagesAsync(doc, tokenId, 1, 0, 100, actor)).Response!;
        Assert.Equal(1, old.Revision); Assert.Equal(2, old.Total);
        Assert.All(old.Items, u => Assert.Equal("componentParameterDefault", u.Kind));
        var calls = reader.Calls;
        Assert.Equal("FORBIDDEN", (await service.UsagesAsync(doc, tokenId, null, 0, 100, new("stranger"))).Code);
        Assert.Equal(calls, reader.Calls);
        var json = JsonSerializer.SerializeToNode(all, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var schema = FigVam.Server.Documents.DocumentSchemas.Create(typeof(TokenUsagesResponse));
        schema.AsObject().Remove("$id");
        Assert.True(JsonSchema.Build(JsonDocument.Parse(schema.ToJsonString()).RootElement.Clone()).EvaluateNode(json).IsValid);
    }
    private sealed class Reader(DocumentStructure current, DocumentStructure historical) : IDocumentStateReader
    {
        public int Calls;
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(revision switch { null or 2 => new DocumentStateReadResult("OK", new(current, 2)), 1 => new DocumentStateReadResult("OK", new(historical, 1)), _ => new DocumentStateReadResult("REVISION_UNAVAILABLE") });
        }
    }
    [Fact]
    public async Task ReadsPagesHistoricalTokensAndDirectUsagesWithAuthorization()
    {
        var doc = Guid.NewGuid(); var tokenId = Guid.NewGuid(); var aliasId = Guid.NewGuid(); var nodeId = Guid.NewGuid();
        DesignToken Token(Guid id, TokenExpression value) => new(id, "space", TokenType.Spacing, new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = value, [TokenTheme.Dark] = value });
        var target = Token(tokenId, new LiteralTokenValue(new SpacingValue(8))); var alias = Token(aliasId, new TokenAlias(tokenId));
        var node = new NodeStructure(nodeId, "test", []) { Properties = System.Collections.Immutable.ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("spacing", new NodeTokenValue(tokenId)) };
        var historical = new DocumentStructure(doc, [], [], []) { Tokens = [target] };
        var current = historical with { Tokens = [target, alias], Nodes = [node] };
        var reader = new Reader(current, historical); var service = new DocumentTokenQueries(new Access(), reader); var actor = new DocumentActor("reader");
        var page = (await service.ListAsync(doc, null, 1, 1, actor)).Response!;
        Assert.Equal(2, page.Total); Assert.Equal(2, page.Revision); Assert.Single(page.Items);
        Assert.Single((await service.ListAsync(doc, 1, 0, 100, actor)).Response!.Items);
        Assert.Equal("TOKEN_NOT_FOUND", (await service.ReadAsync(doc, aliasId, 1, actor)).Code);
        Assert.Equal(tokenId, (await service.ReadAsync(doc, tokenId, 1, actor)).Response!.Token.Id);
        var usages = (await service.UsagesAsync(doc, tokenId, null, 0, 100, actor)).Response!;
        Assert.Equal(3, usages.Total); Assert.Contains(usages.Items, u => u.Kind == "nodeProperty" && u.OwnerId == nodeId && u.Property == "spacing");
        Assert.Contains(usages.Items, u => u.Kind == "tokenAlias" && u.OwnerId == aliasId && u.Theme == TokenTheme.Light);
        Assert.Single((await service.UsagesAsync(doc, tokenId, null, 2, 1, actor)).Response!.Items);
        Assert.Empty((await service.UsagesAsync(doc, tokenId, 1, 0, 100, actor)).Response!.Items);
        Assert.Equal("INVALID_QUERY", (await service.ListAsync(doc, null, -1, 1, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.UsagesAsync(doc, tokenId, null, 0, 101, actor)).Code);
        Assert.Equal("INVALID_REVISION", (await service.ListAsync(doc, -1, 0, 1, actor)).Code);
        Assert.Equal("REVISION_UNAVAILABLE", (await service.ListAsync(doc, 3, 0, 1, actor)).Code);
        var calls = reader.Calls; Assert.Equal("FORBIDDEN", (await service.ReadAsync(doc, tokenId, null, new("stranger"))).Code); Assert.Equal(calls, reader.Calls);
    }
    [Fact]
    public async Task HttpContractsCoverRevisionPaginationAndIsolation()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        // Windows CI can pause a cold test server briefly under parallel browser load.
        client.Timeout = TimeSpan.FromSeconds(30);
        var doc = Guid.NewGuid(); var tokenId = Guid.NewGuid(); var aliasId = Guid.NewGuid();
        var route = $"/api/v1/documents/{doc}/tokens";
        Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        object Literal() => new { expression = "literal", value = new { type = "spacing", value = 8 } };
        object Alias() => new { expression = "alias", tokenId };
        async Task Add(Guid id, object value) => Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/add-token", new { commandId = Guid.NewGuid(), tokenId = id, name = "space", type = 1, values = new { Light = value, Dark = value } })).StatusCode);
        await Add(tokenId, Literal()); await Add(aliasId, Alias());
        foreach (var (path, schemaName) in new[] { (route + "?limit=1", "TokenListResponse"), (route + "/" + tokenId + "?revision=1", "TokenResponse"), (route + "/" + tokenId + "/usages?limit=1", "TokenUsagesResponse") })
        {
            var payload = JsonNode.Parse(await client.GetStringAsync(path))!;
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(payload).IsValid);
        }
        var uses = JsonNode.Parse(await client.GetStringAsync(route + "/" + tokenId + "/usages"))!;
        Assert.Equal(2, (int)uses["total"]!); Assert.Equal(aliasId.ToString(), (string)uses["items"]![0]!["ownerId"]!);
        Assert.Equal(404, (int)(await client.GetAsync(route + "/" + aliasId + "?revision=1")).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(route + "/" + Guid.NewGuid())).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?limit=101")).StatusCode);
        var invalidRevision = await client.GetAsync(route + "?revision=99");
        Assert.Equal(400, (int)invalidRevision.StatusCode);
        Assert.Equal("INVALID_REVISION", (string)JsonNode.Parse(await invalidRevision.Content.ReadAsStringAsync())!["code"]!);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(200, (int)(await client.GetAsync(route + "/" + tokenId)).StatusCode);
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/tokens/{tokenId}/usages"]!["get"]!["responses"]!["200"]);
        Assert.Contains("TOKEN_NOT_FOUND", openapi["info"]!["description"]!.ToString());
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "stranger"));
        Assert.Equal(403, (int)(await client.GetAsync(route)).StatusCode);
        Assert.Equal(403, (int)(await client.GetAsync(route + "/" + tokenId + "/usages")).StatusCode);
    }
}

