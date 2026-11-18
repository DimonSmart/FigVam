using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentQueryTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentState state) : IDocumentStateReader
    {
        public Task<DocumentStateReadResult> ReadAsync(Guid documentId, long? revision, CancellationToken ct = default)
            => Task.FromResult(state.Document.Id != documentId ? new DocumentStateReadResult("DOCUMENT_NOT_FOUND") :
                revision is not null && revision != state.Revision ? new DocumentStateReadResult("REVISION_UNAVAILABLE") : new DocumentStateReadResult("OK", state));
    }

    [Fact]
    public async Task MetadataFiltersComposeBeforePaginationAndAllowDuplicateNames()
    {
        var doc = Guid.NewGuid(); var screen = Guid.NewGuid(); var a = Guid.NewGuid(); var b = Guid.NewGuid(); var c = Guid.NewGuid();
        var structure = new DocumentStructure(doc, [], [new(screen, [c, b, a], new(800, 600))], [
            new(a, "Text", []) { Name = "Button", SemanticKey = "submit" },
            new(b, "Text", []) { Name = "Button", SemanticKey = "submit" },
            new(c, "Text", []) { Name = "button", SemanticKey = "other" }]);
        var service = new DocumentStructureQueries(new Access(), new Reader(new(structure, 4)));
        var actor = new DocumentActor("reader");
        var query = new StructureQuery("children", screen, Limit: 1, Fields: "name,semanticKey", SemanticKey: "submit", NamePrefix: "But");
        var result = (await service.QueryAsync(doc, query, actor)).Response!;
        Assert.Equal(2, result.Total); var item = Assert.Single(result.Items);
        Assert.Equal(b, item.Id); Assert.Equal("Button", item.Name); Assert.Equal("submit", item.SemanticKey); Assert.Null(item.Kind);
        Assert.Equal(a, Assert.Single((await service.QueryAsync(doc, query with { Offset = 1 }, actor)).Response!.Items).Id);
        Assert.Equal(2, (await service.QueryAsync(doc, query with { Resource = "nodes", ObjectId = null, ScreenId = screen, Kind = "Text" }, actor)).Response!.Total);
        Assert.Null(Assert.Single((await service.QueryAsync(doc, new("node", a, Fields: "kind"), actor)).Response!.Items).Name);
        Assert.Equal("FORBIDDEN", (await service.QueryAsync(doc, query, new("other"))).Code);
        Assert.Equal("INVALID_QUERY", (await service.QueryAsync(doc, query with { NamePrefix = new string('x', 257) }, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.QueryAsync(doc, new("pages", SemanticKey: "submit"), actor)).Code);
    }

    [Fact]
    public async Task PageScreensAreOrderedPaginatedAndAuthorized()
    {
        var doc = Guid.NewGuid(); var page = Guid.NewGuid();
        var ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray();
        var structure = new DocumentStructure(doc, [new(page, ids)], ids.Select(id => new ScreenStructure(id, [], new(800, 600))).ToArray(), []);
        var service = new DocumentStructureQueries(new Access(), new Reader(new(structure, 7)));
        var first = (await service.QueryAsync(doc, new("page-screens", page, Limit: 100, Fields: "dimensions"), new("reader"))).Response!;
        Assert.Equal(101, first.Total); Assert.Equal(ids.Take(100), first.Items.Select(i => i.Id));
        var last = (await service.QueryAsync(doc, new("page-screens", page, Offset: 100), new("reader"))).Response!;
        Assert.Equal(ids[100], Assert.Single(last.Items).Id); Assert.Equal(7, last.Revision);
        Assert.Equal("PAGE_NOT_FOUND", (await service.QueryAsync(doc, new("page-screens", Guid.NewGuid()), new("reader"))).Code);
        Assert.Equal("FORBIDDEN", (await service.QueryAsync(doc, new("page-screens", page), new("other"))).Code);
    }

    [Fact]
    public async Task QueriesBoundDepthAndFieldsAndPreserveChildOrder()
    {
        var doc = Guid.NewGuid(); var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var a = Guid.NewGuid(); var b = Guid.NewGuid(); var c = Guid.NewGuid();
        var structure = new DocumentStructure(doc, [new(page, [screen])], [new(screen, [b, a], new(800, 600))], [new(a, "Text", []), new(b, "Frame", [c]), new(c, "Text", [])]);
        var service = new DocumentStructureQueries(new Access(), new Reader(new(structure, 9)));
        var actor = new DocumentActor("reader");
        var children = (await service.QueryAsync(doc, new("children", screen, 0, 1), actor)).Response!;
        Assert.Equal(9, children.Revision); Assert.Equal(2, children.Total); Assert.Equal(b, Assert.Single(children.Items).Id);
        var next = (await service.QueryAsync(doc, new("children", screen, 1, 1), actor)).Response!;
        Assert.Equal(a, Assert.Single(next.Items).Id);
        var filtered = (await service.QueryAsync(doc, new("nodes", ScreenId: screen, Kind: "Text"), actor)).Response!;
        Assert.Equal(new[] { c, a }, filtered.Items.Select(x => x.Id));
        var nested = (await service.QueryAsync(doc, new("screen", screen, Depth: 2, Fields: "childCount"), actor)).Response!;
        var first = Assert.Single(nested.Items).Children![0]; Assert.Null(first.Kind); Assert.Equal(c, Assert.Single(first.Children!).Id);
        Assert.Equal("INVALID_QUERY", (await service.QueryAsync(doc, new("nodes", Limit: 101), actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.QueryAsync(doc, new("node", a, Depth: 3), actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.QueryAsync(doc, new("nodes", Fields: "secret"), actor)).Code);
        Assert.Equal("FORBIDDEN", (await service.QueryAsync(doc, new("node", a), new("other"))).Code);
        Assert.Equal("NODE_NOT_FOUND", (await service.QueryAsync(doc, new("node", Guid.NewGuid()), actor)).Code);
    }

    [Fact]
    public async Task HttpHistoricalQueriesShareRevisionContractAndCheckCurrentAccess()
    {
        using var key = RSA.Create(2048);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-revision-api-" + Guid.NewGuid());
        var config = Production(key); config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner"); var doc = Guid.NewGuid(); var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var missing = Guid.NewGuid();
        var root = $"/api/v1/documents/{doc}";
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-page", new { commandId = Guid.NewGuid(), pageId = page })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen", new { commandId = Guid.NewGuid(), pageId = page, screenId = screen , dimensions = new { width = 800, height = 600 } })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        Actor("viewer");
        var routes = new[] { "", "/pages", $"/pages/{page}", $"/pages/{page}/screens", "/screens", $"/screens/{screen}", "/nodes", $"/nodes/{missing}", $"/children/{screen}" };
        foreach (var route in routes)
        {
            using var response = await client.GetAsync(root + route + "?revision=2");
            Assert.Equal(route == $"/nodes/{missing}" ? 404 : 200, (int)response.StatusCode);
            if (response.IsSuccessStatusCode) Assert.Equal(2, (await response.Content.ReadFromJsonAsync<StructureResponse>())!.Revision);
        }
        Assert.Empty((await client.GetFromJsonAsync<StructureResponse>(root + "/screens?revision=1"))!.Items);
        Assert.Empty((await client.GetFromJsonAsync<StructureResponse>(root + "/pages?revision=0"))!.Items);
        Assert.Equal(404, (int)(await client.GetAsync(root + $"/screens/{screen}?revision=1")).StatusCode);
        foreach (var value in new[] { "-1", "3", long.MaxValue.ToString(), "", "1&revision=2" })
        {
            using var response = await client.GetAsync(root + "/pages?revision=" + value);
            Assert.Equal(400, (int)response.StatusCode);
            Assert.Equal("INVALID_REVISION", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        foreach (var value in new[] { "bad", "9223372036854775808" })
        {
            using var response = await client.GetAsync(root + "/pages?revision=" + value);
            Assert.Equal(400, (int)response.StatusCode);
            Assert.Equal("INVALID_REQUEST", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        Actor("owner");
        Assert.Equal(200, (int)(await client.DeleteAsync(root + "/members/viewer")).StatusCode);
        Actor("viewer");
        foreach (var route in routes) Assert.Equal(403, (int)(await client.GetAsync(root + route + "?revision=0")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(401, (int)(await client.GetAsync(root + "?revision=0")).StatusCode);
        Actor("owner");
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        foreach (var route in new[] { "", "/pages", "/pages/{pageId}", "/pages/{pageId}/screens", "/screens", "/screens/{screenId}", "/nodes", "/nodes/{nodeId}", "/children/{parentId}" })
        {
            var operation = api["paths"]!["/api/v1/documents/{documentId}" + route]!["get"]!;
            var revision = operation["parameters"]!.AsArray().Single(p => p!["name"]!.GetValue<string>().Equals("revision", StringComparison.OrdinalIgnoreCase))!;
            Assert.Contains("integer", revision["schema"]!["type"]!.ToJsonString());
            Assert.Equal("int64", revision["schema"]!["format"]!.GetValue<string>());
            Assert.False(revision["required"]?.GetValue<bool>() ?? false);
        }
        var schema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/QueryOptions.json"))!;
        Assert.NotNull(schema["properties"]!["revision"]);
        using var schemaDoc = System.Text.Json.JsonDocument.Parse(schema.ToJsonString());
        var contract = JsonSchema.Build(schemaDoc.RootElement.Clone());
        Assert.True(contract.EvaluateNode(JsonNode.Parse("{\"revision\":0}")!).IsValid);
        Assert.False(contract.EvaluateNode(JsonNode.Parse("{\"revision\":\"bad\"}")!).IsValid);

        // Simulate retention after a sufficient recovery snapshot exists.
        var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
        var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
        for (var i = 0; i < 30; i++) Assert.True((await handler.HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), new("owner"))).Accepted);
        using var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{doc:N}.sqlite")};Pooling=False");
        await connection.OpenAsync();
        using var command = connection.CreateCommand(); command.CommandText = "DELETE FROM snapshots WHERE revision=0"; await command.ExecuteNonQueryAsync();
        using var unavailable = await client.GetAsync(root + "?revision=1");
        Assert.Equal(404, (int)unavailable.StatusCode);
        Assert.Equal("REVISION_UNAVAILABLE", (await unavailable.Content.ReadFromJsonAsync<ApiError>())!.Code);
        Assert.Equal(32, (await client.GetFromJsonAsync<StructureResponse>(root))!.Revision);
    }

    [Fact]
    public async Task HttpReadsCommittedRevisionAndPublishesContracts()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner"); var doc = Guid.NewGuid(); var other = Guid.NewGuid(); var page = Guid.NewGuid();
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = other })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/add-page", new { commandId = Guid.NewGuid(), pageId = page })).StatusCode);
        var result = (await client.GetFromJsonAsync<StructureResponse>($"/api/v1/documents/{doc}/pages"))!;
        Assert.Equal(1, result.Revision); Assert.Equal(page, Assert.Single(result.Items).Id);
        Assert.Equal(404, (int)(await client.GetAsync($"/api/v1/documents/{other}/pages/{page}")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync($"/api/v1/documents/{doc}/pages?limit=101")).StatusCode);
        Actor("stranger"); Assert.Equal(403, (int)(await client.GetAsync($"/api/v1/documents/{doc}/pages/{page}")).StatusCode);
        Actor("owner");
        Assert.Empty((await client.GetFromJsonAsync<StructureResponse>($"/api/v1/documents/{doc}/nodes?semanticKey=submit&namePrefix=But&fields=name,semanticKey"))!.Items);
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/nodes"]!["get"]!["responses"]!["200"]);
        var parameters = api["paths"]!["/api/v1/documents/{documentId}/nodes"]!["get"]!["parameters"]!.ToJsonString();
        Assert.Contains("SemanticKey", parameters, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("NamePrefix", parameters, StringComparison.OrdinalIgnoreCase);
        var itemSchema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/StructureItem.json"))!;
        Assert.NotNull(itemSchema["properties"]!["name"]); Assert.NotNull(itemSchema["properties"]!["semanticKey"]);
        var schema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/StructureResponse.json"))!;
        Assert.NotNull(schema["properties"]!["revision"]);
        using var schemaDocument = System.Text.Json.JsonDocument.Parse(schema.ToJsonString());
        var contract = JsonSchema.Build(schemaDocument.RootElement.Clone());
        var payload = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)))!;
        Assert.True(contract.EvaluateNode(payload).IsValid);
    }
}

