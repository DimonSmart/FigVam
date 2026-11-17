using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ReconnectApiTests
{
    [Fact]
    public async Task RecoveryIsOrderedBoundedAuthorizedAndDocumented()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-reconnect-api", Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner");
        var id = Guid.NewGuid();
        var root = $"/api/v1/documents/{id}";
        Assert.Equal  (201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
        var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
        for (int i = 0; i < 101; i++)
            Assert.True((await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), new DocumentActor("owner"))).Accepted);
        Actor("viewer");
        var result = (await client.GetFromJsonAsync<ReconnectResponse>(root + "/reconnect?lastSeenRevision=98"))!;
        Assert.Equal("EVENTS", result.Code);
        Assert.Equal(101, result.Revision);
        Assert.Equal(new long[] { 99, 100, 101 }, result.Events!.Select(e => e.Revision));
        Assert.All(result.Events!, e => { Assert.Equal("SAVE_VERSION", e.Type); Assert.Equal("owner", e.ActorId); Assert.IsType<VersionSaved>(e.Payload); });
        var snapshot = (await client.GetFromJsonAsync<ReconnectResponse>(root + "/reconnect?lastSeenRevision=0"))!;
        Assert.Equal("SNAPSHOT", snapshot.Code);
        Assert.Equal(101, snapshot.Snapshot!.Revision);
        Assert.Null(snapshot.Events);
        foreach (var query in new[] { "", "?lastSeenRevision=-1", "?lastSeenRevision=102", "?lastSeenRevision=x", "?lastSeenRevision=0&lastSeenRevision=1", "?lastSeenRevision=0&actorId=owner" })
            Assert.Equal(400, (int)(await client.GetAsync(root + "/reconnect" + query)).StatusCode);
        Actor("stranger");
        using var denied = await client.GetAsync(root + "/reconnect?lastSeenRevision=0");
        Assert.Equal(403, (int)denied.StatusCode);
        Assert.Equal("FORBIDDEN", (await denied.Content.ReadFromJsonAsync<ApiError>())!.Code);
        Actor("owner");
        Assert.Equal(200, (int)(await client.DeleteAsync(root + "/members/viewer")).StatusCode);
        Actor("viewer");
        Assert.Equal(403, (int)(await client.GetAsync(root + "/reconnect?lastSeenRevision=101")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(401, (int)(await client.GetAsync(root + "/reconnect?lastSeenRevision=0")).StatusCode);
        Actor("owner");
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/reconnect"]!["get"]!["responses"]!["200"]);
        using var schemaJson = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/ReconnectResponse.json"));
        var schema = JsonSchema.Build(schemaJson.RootElement.Clone());
        Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(result, JsonSerializerOptions.Web)!).IsValid);
        Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(snapshot, JsonSerializerOptions.Web)!).IsValid);
    }

    [Fact]
    public void EveryEventPayloadSerializesAndMatchesPublishedSchema()
    {
        var id = Guid.NewGuid();
        var document = new DocumentStructure(id, [], [], []);
        DocumentEvent[] payloads = [new PageAdded(id), new ScreenAdded(id,id), new NodeAdded(id,id,"kind"),
            new NodeMoved(id,id,0), new NodeDeleted(id), new NodePropertySet(id,"text",new NodeStringValue("value")),
            new VersionSaved(id), new VersionRestored(id,document), new HistoryCompensated(id,false,new DocumentPatch([],[],[]))];
        using var doc = JsonDocument.Parse(DocumentSchemas.Create(typeof(CommittedDocumentEvent)).ToJsonString());
        var schema = JsonSchema.Build(doc.RootElement.Clone());
        foreach (var payload in payloads)
        {
            var ev = new CommittedDocumentEvent(id, 1, Guid.NewGuid(), "actor", "TYPE", payload);
            var json = JsonSerializer.SerializeToNode(ev, JsonSerializerOptions.Web)!;
            Assert.NotNull(json["payload"]!["payloadType"]);
            Assert.True(schema.EvaluateNode(json).IsValid, json.ToJsonString());
            Assert.Equal(payload.GetType(), JsonSerializer.Deserialize<CommittedDocumentEvent>(json, JsonSerializerOptions.Web)!.Payload.GetType());
        }
    }
}

