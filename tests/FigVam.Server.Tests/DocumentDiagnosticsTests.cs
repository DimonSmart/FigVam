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
public sealed class DocumentDiagnosticsTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentStructure document) : IDocumentStateReader
    {
        public int Calls;
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(revision is null or 2 ? new DocumentStateReadResult("OK", new(document, 2)) : new DocumentStateReadResult("REVISION_UNAVAILABLE"));
        }
    }
    [Fact]
    public async Task MapsScopesAndPagesDiagnosticsAtSelectedRevision()
    {
        var doc = Guid.NewGuid(); var s1 = Guid.NewGuid(); var s2 = Guid.NewGuid();
        var nodes = Enumerable.Range(0, 105).Select(_ => new NodeStructure(Guid.NewGuid(), "Unverified", [])).ToArray();
        var structure = new DocumentStructure(doc, [], [new(s1, nodes.Take(104).Select(n => n.Id).ToArray(), new(800, 600)), new(s2, [nodes[104].Id], new(800, 600))], nodes);
        var reader = new Reader(structure); var service = new DocumentDiagnostics(new Access(), reader, new UnverifiedNodeProfile());
        var all = (await service.ReadAsync(doc, null, 2, 0, 100, new("reader"))).Response!;
        Assert.Equal(2, all.Revision); Assert.Equal(105, all.Total); Assert.Equal(100, all.Items.Count);
        Assert.All(all.Items, item => { Assert.Equal("unknown-node-kind", item.Code); Assert.Contains("/nodes/", item.Path); });
        var scope = (await service.ReadAsync(doc, s2, null, 0, 10, new("reader"))).Response!;
        Assert.Equal(2, scope.Revision); Assert.Equal(1, scope.Total); Assert.EndsWith(nodes[104].Id.ToString(), Assert.Single(scope.Items).Path);
        Assert.Equal("SCREEN_NOT_FOUND", (await service.ReadAsync(doc, Guid.NewGuid(), null, 0, 10, new("reader"))).Code);
        Assert.Equal("REVISION_UNAVAILABLE", (await service.ReadAsync(doc, null, 1, 0, 10, new("reader"))).Code);
        Assert.Equal("INVALID_QUERY", (await service.ReadAsync(doc, null, null, 0, 101, new("reader"))).Code);
        var calls = reader.Calls; Assert.Equal("FORBIDDEN", (await service.ReadAsync(doc, null, null, 0, 10, new("other"))).Code); Assert.Equal(calls, reader.Calls);
    }
    [Fact]
    public async Task HttpContractsAndAccess()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); var doc = Guid.NewGuid(); var route = $"/api/v1/documents/{doc}/diagnostics";
        Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var response = await client.GetAsync(route + "?revision=0"); Assert.Equal(200, (int)response.StatusCode);
        var payload = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        var schema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/StructureDiagnosticsResponse.json"))!;
        using var json = JsonDocument.Parse(schema.ToJsonString()); Assert.True(JsonSchema.Build(json.RootElement.Clone()).EvaluateNode(payload).IsValid);
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/diagnostics"]!["get"]!["responses"]!["200"]);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?limit=101")).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(route + "?screenId=" + Guid.NewGuid())).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "stranger"));
        Assert.Equal(403, (int)(await client.GetAsync(route)).StatusCode);
    }
}
