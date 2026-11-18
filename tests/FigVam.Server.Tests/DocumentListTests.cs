using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentListTests
{
    [Fact]
    public async Task QueryPaginatesMembershipAndReadsCurrentName()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-list-" + Guid.NewGuid());
        try
        {
            var store = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var owner = new DocumentActor("owner"); var viewer = new DocumentActor("viewer");
            var ids = new[] { Guid.Parse("00000000-0000-0000-0000-000000000001"), Guid.Parse("00000000-0000-0000-0000-000000000002"), Guid.Parse("00000000-0000-0000-0000-000000000003") };
            foreach (var id in ids) Assert.True((await store.CreateAsync(new(id, "Initial"), owner)).Accepted);
            await store.SetMemberAsync(ids[0], viewer.Id, DocumentRole.Viewer, owner);
            await store.SetMemberAsync(ids[2], viewer.Id, DocumentRole.Editor, owner);
            var handler = new DocumentCommandHandler(store, store, new UnverifiedNodeProfile());
            Assert.True((await handler.HandleAsync(new RenameDocumentCommand(ids[0], Guid.NewGuid(), "Current"), owner)).Accepted);
            var first = await store.ListAsync(viewer, 1);
            Assert.Equal(new DocumentListItem(ids[0], "Current", "Viewer"), Assert.Single(first.Items));
            Assert.Equal(ids[0], first.NextCursor);
            var second = await store.ListAsync(viewer, 1, first.NextCursor);
            Assert.Equal(new DocumentListItem(ids[2], "Initial", "Editor"), Assert.Single(second.Items));
            Assert.Null(second.NextCursor);
            await store.RemoveMemberAsync(ids[2], viewer.Id, owner);
            Assert.Empty((await store.ListAsync(viewer, 1, first.NextCursor)).Items);
            Assert.Empty((await store.ListAsync(new("outsider"))).Items);
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => store.ListAsync(owner, 101));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task HttpListRequiresAuthenticationAndPublishesContract()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        config["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-list-api", Guid.NewGuid().ToString("N"));
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        Assert.Equal(401, (int)(await client.GetAsync("/api/v1/documents")).StatusCode);
        void Actor(string actor) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
        Actor("owner"); var id = Guid.NewGuid();
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id, name = "Before" })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/rename-document", new { commandId = Guid.NewGuid(), name = "After" })).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync("/api/v1/documents?limit=101")).StatusCode);
        Actor("viewer");
        var json = JsonNode.Parse(await client.GetStringAsync("/api/v1/documents?limit=1"))!;
        Assert.Equal("After", (string?)json["items"]![0]!["name"]);
        Assert.Equal("Viewer", (string?)json["items"]![0]!["role"]);
        using var schemaDoc = System.Text.Json.JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DocumentListResponse.json"));
        Assert.True(JsonSchema.Build(schemaDoc.RootElement.Clone()).EvaluateNode(json).IsValid);
        Actor("outsider"); Assert.Empty(JsonNode.Parse(await client.GetStringAsync("/api/v1/documents"))!["items"]!.AsArray());
        Actor("owner"); await client.DeleteAsync($"/api/v1/documents/{id}/members/viewer");
        Actor("viewer"); Assert.Empty(JsonNode.Parse(await client.GetStringAsync("/api/v1/documents"))!["items"]!.AsArray());
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        var operation = api["paths"]!["/api/v1/documents"]!["get"]!;
        Assert.NotNull(operation["security"]![0]!["Bearer"]);
        Assert.Contains("DocumentListResponse", operation["responses"]!["200"]!.ToJsonString());
    }
}
