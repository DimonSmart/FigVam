using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ComponentQueryTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentStructure current, DocumentStructure historical) : IDocumentStateReader
    {
        public int Calls;
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(id != current.Id ? new DocumentStateReadResult("DOCUMENT_NOT_FOUND") : revision switch {
                null or 2 => new DocumentStateReadResult("OK", new(current, 2)), 1 => new DocumentStateReadResult("OK", new(historical, 1)), _ => new DocumentStateReadResult("REVISION_UNAVAILABLE") });
        }
    }
    [Fact]
    public async Task SearchAndUsagesAreOrderedPagedRevisionSpecificAndAuthorized()
    {
        var doc = Guid.NewGuid(); var a = Guid.NewGuid(); var b = Guid.NewGuid(); var n1 = Guid.NewGuid(); var n2 = Guid.NewGuid();
        ComponentDefinition Definition(Guid id, string name) => new(id, name, "Description", Guid.NewGuid(), [], [], []);
        ComponentInstance Instance(Guid node, Guid definition) => new(node, definition, null, new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>());
        var historical = new DocumentStructure(doc, [], [], []) { ComponentDefinitions = [Definition(a, "Card")] };
        var current = historical with { ComponentDefinitions = [Definition(b, "card large"), historical.ComponentDefinitions[0]], ComponentInstances = [Instance(n2, a), Instance(n1, a)] };
        var reader = new Reader(current, historical); var service = new DocumentComponentQueries(new Access(), reader); var actor = new DocumentActor("reader");
        var page = (await service.ListAsync(doc, null, "CARD", 0, 1, actor)).Response!;
        Assert.Equal(2, page.Total); Assert.Equal(a, Assert.Single(page.Items).Id); Assert.Equal("Description", page.Items[0].Description);
        Assert.Equal(b, Assert.Single((await service.ListAsync(doc, null, "card", 1, 1, actor)).Response!.Items).Id);
        Assert.Empty((await service.ListAsync(doc, null, "missing", 0, 10, actor)).Response!.Items);
        Assert.Equal(a, (await service.ReadAsync(doc, a, 1, actor)).Response!.Component.Id);
        Assert.Equal("COMPONENT_NOT_FOUND", (await service.ReadAsync(doc, b, 1, actor)).Code);
        var usages = (await service.UsagesAsync(doc, a, null, 0, 1, actor)).Response!;
        Assert.Equal(2, usages.Total); Assert.Equal(new[] { n1, n2 }.Order().First(), Assert.Single(usages.Items).NodeId);
        Assert.Equal(new[] { n1, n2 }.Order().Last(), Assert.Single((await service.UsagesAsync(doc, a, null, 1, 1, actor)).Response!.Items).NodeId);
        Assert.Empty((await service.UsagesAsync(doc, a, 1, 0, 10, actor)).Response!.Items);
        Assert.Equal("COMPONENT_NOT_FOUND", (await service.UsagesAsync(doc, b, 1, 0, 10, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.ListAsync(doc, null, new string('x', 257), 0, 1, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await service.UsagesAsync(doc, a, null, 0, 101, actor)).Code);
        Assert.Equal("INVALID_REVISION", (await service.ListAsync(doc, -1, null, 0, 1, actor)).Code);
        var calls = reader.Calls;
        Assert.Equal("FORBIDDEN", (await service.ListAsync(doc, null, null, 0, 1, new("stranger"))).Code);
        Assert.Equal("FORBIDDEN", (await service.ReadAsync(doc, a, null, new("stranger"))).Code);
        Assert.Equal("FORBIDDEN", (await service.UsagesAsync(doc, a, null, 0, 1, new("stranger"))).Code);
        Assert.Equal(calls, reader.Calls);
    }
    [Fact]
    public async Task HttpPublishesContractsAndEnforcesIsolation()
    {
        using var key = RSA.Create(2048); var directory = Path.Combine(Path.GetTempPath(), "figvam-components-" + Guid.NewGuid()); var config = Production(key); config["Storage__Directory"] = directory; await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var component = Guid.NewGuid();
        var root = $"/api/v1/documents/{doc}"; var route = root + "/components";
        Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var listPayload = JsonNode.Parse(await client.GetStringAsync(route + "?search=ard&limit=1"))!;
        var samples = new (JsonNode Payload, string Name)[] {
            (listPayload, "ComponentListResponse"),
            (JsonSerializer.SerializeToNode(new ComponentResponse(doc, 0, new(component, "Card", "Description", node, [], [], [])), new JsonSerializerOptions(JsonSerializerDefaults.Web))!, "ComponentResponse"),
            (JsonSerializer.SerializeToNode(new ComponentUsagesResponse(doc, 0, component, [], 0, 50, 0), new JsonSerializerOptions(JsonSerializerDefaults.Web))!, "ComponentUsagesResponse") };
        foreach (var (payload, schemaName) in samples)
        {
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(payload).IsValid);
        }
        Assert.Equal(404, (int)(await client.GetAsync(route + "/" + component)).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(route + "/" + component + "/usages")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?limit=101")).StatusCode);
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/components/{componentId}/usages"]!["get"]!["responses"]!["200"]);
        Assert.Contains("COMPONENT_NOT_FOUND", api["info"]!["description"]!.ToString());
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(200, (int)(await client.GetAsync(route)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "stranger"));
        foreach (var path in new[] { route, route + "/" + component, route + "/" + component + "/usages" }) Assert.Equal(403, (int)(await client.GetAsync(path)).StatusCode);
    }
}



