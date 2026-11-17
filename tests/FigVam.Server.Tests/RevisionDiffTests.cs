using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class RevisionDiffTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentStructure a, DocumentStructure b) : IDocumentStateReader
    {
        public int Calls;
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(revision switch { 1 => new DocumentStateReadResult("OK", new(a, 1)), 2 => new DocumentStateReadResult("OK", new(b, 2)), _ => new DocumentStateReadResult("REVISION_UNAVAILABLE") });
        }
    }
    [Fact]
    public async Task ComparesStructuralChangesAndPaginatesDeterministically()
    {
        var doc = Guid.NewGuid(); var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var a = Guid.NewGuid(); var b = Guid.NewGuid(); var c = Guid.NewGuid();
        var first = new DocumentStructure(doc, [new(page, [screen])], [new(screen, [a, b])], [new(a, "Frame", []) { Name = "Old" }, new(b, "Text", [])]);
        var second = new DocumentStructure(doc, [new(page, [screen])], [new(screen, [c, a])], [new(a, "Frame", []) { Name = "New", SemanticKey = "key", Properties = System.Collections.Immutable.ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("text", new NodeStringValue("hello")) }, new(c, "Text", [])]);
        var reader = new Reader(first, second); var service = new DocumentRevisionDiff(new Access(), reader); var actor = new DocumentActor("reader");
        var result = (await service.CompareAsync(doc, 1, 2, 0, 100, actor)).Response!;
        Assert.Equal(3, result.Total);
        var modified = result.Items.Single(x => x.Id == a); Assert.Equal("modified", modified.Change);
        Assert.Equal(new[] { "name", "position", "properties.text", "semanticKey" }, modified.ChangedProperties);
        Assert.Equal("removed", result.Items.Single(x => x.Id == b).Change);
        Assert.Equal("added", result.Items.Single(x => x.Id == c).Change);
        var paged = new List<RevisionDiffItem>();
        for (var i = 0; i < result.Total; i++) paged.Add(Assert.Single((await service.CompareAsync(doc, 1, 2, i, 1, actor)).Response!.Items));
        Assert.Equal(result.Items.Select(x => (x.Id, x.Type, x.Change, string.Join(',', x.ChangedProperties))), paged.Select(x => (x.Id, x.Type, x.Change, string.Join(',', x.ChangedProperties))));
        Assert.Equal("REVISION_UNAVAILABLE", (await service.CompareAsync(doc, 1, 3, 0, 1, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.CompareAsync(doc, 1, 2, 0, 101, actor)).Code);
        var calls = reader.Calls; Assert.Equal("FORBIDDEN", (await service.CompareAsync(doc, -1, 3, 0, 1, new("stranger"))).Code); Assert.Equal(calls, reader.Calls);
    }

    [Fact]
    public async Task HttpPublishesContractsAndEnforcesAccess()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner"); var doc = Guid.NewGuid(); var page = Guid.NewGuid(); var route = $"/api/v1/documents/{doc}/revision-diff";
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/add-page", new { commandId = Guid.NewGuid(), pageId = page })).StatusCode);
        var response = await client.GetAsync(route + "?fromRevision=0&toRevision=1"); Assert.Equal(200, (int)response.StatusCode);
        var payload = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.Equal("added", payload["items"]![0]!["change"]!.GetValue<string>());
        var schema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/RevisionDiffResponse.json"))!;
        using var json = JsonDocument.Parse(schema.ToJsonString()); Assert.True(JsonSchema.Build(json.RootElement.Clone()).EvaluateNode(payload).IsValid);
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/revision-diff"]!["get"]!["responses"]!["200"]);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?fromRevision=0&toRevision=1&limit=101")).StatusCode);
        Actor("stranger"); Assert.Equal(403, (int)(await client.GetAsync(route + "?fromRevision=0&toRevision=1")).StatusCode);
    }
}

