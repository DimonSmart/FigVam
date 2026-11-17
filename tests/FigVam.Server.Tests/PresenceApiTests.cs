using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class PresenceApiTests
{
    [Fact]
    public async Task PresenceIsAuthenticatedIsolatedValidatedAndDocumentedWithoutRevisions()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-presence-api", Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner");
        var id = Guid.NewGuid(); var other = Guid.NewGuid();
        var root = $"/api/v1/documents/{id}";
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = other })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        var selected = Guid.NewGuid();
        var update = new { name = "Owner", color = "#123456", cursor = new { x = 1.0, y = 2.0 }, selectedIds = new[] { selected }, screenId = Guid.NewGuid() };
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/presence", update)).StatusCode);
        Actor("viewer");
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/presence", new { name = "Viewer", color = "#abcdef", selectedIds = Array.Empty<Guid>() })).StatusCode);
        var result = (await client.GetFromJsonAsync<PresenceParticipantsResponse>(root + "/presence"))!;
        Assert.Equal(2, result.Participants.Count);
        Assert.Equal(selected, result.Participants.Single(p => p.ActorId == "owner").SelectedIds.Single());
        Assert.Equal(403, (int)(await client.GetAsync($"/api/v1/documents/{other}/presence")).StatusCode);
        foreach (var invalid in new object[] {
            new { name = " ", color = "#123456", selectedIds = Array.Empty<Guid>() },
            new { name = "x", color = "red", selectedIds = Array.Empty<Guid>() },
            new { name = "x", color = "#123456", selectedIds = new[] { Guid.Empty } },
            new { name = "x", color = "#123456", selectedIds = Enumerable.Repeat(Guid.NewGuid(), 101).ToArray() },
            new { name = "x", color = "#123456", selectedIds = Array.Empty<Guid>(), actorId = "owner" },
            new { name = "x", color = "#123456", selectedIds = Array.Empty<Guid>(), cursor = new { x = 10000001, y = 0 } }
        })
        {
            using var response = await client.PutAsJsonAsync(root + "/presence", invalid);
            Assert.Equal(400, (int)response.StatusCode);
            Assert.NotNull((await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        Actor("stranger");
        Assert.Equal(403, (int)(await client.PutAsJsonAsync(root + "/presence", update)).StatusCode);
        Assert.Equal(403, (int)(await client.GetAsync(root + "/presence")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(401, (int)(await client.GetAsync(root + "/presence")).StatusCode);
        Actor("owner");
        var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
        Assert.Equal(0, (await journal.ReadAsync(id))!.Revision);
        Assert.Empty((await journal.ReadEventsAsync(id, 0)).Events!);
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/presence"]!["put"]);
        Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/presence"]!["get"]);
        foreach (var (name, value) in new (string, JsonNode)[] {
            ("PresenceUpdateRequest", JsonSerializer.SerializeToNode(update, JsonSerializerOptions.Web)!),
            ("PresenceParticipantsResponse", JsonSerializer.SerializeToNode(result, JsonSerializerOptions.Web)!),
            ("PresenceUpdateResponse", JsonSerializer.SerializeToNode(new PresenceUpdateResponse("UPDATED"), JsonSerializerOptions.Web)!) })
        {
            using var schemaJson = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{name}.json"));
            Assert.True(JsonSchema.Build(schemaJson.RootElement.Clone()).EvaluateNode(value).IsValid, name);
        }
        Assert.Equal(200, (int)(await client.DeleteAsync(root + "/members/viewer")).StatusCode);
        Actor("viewer");
        Assert.Equal(403, (int)(await client.GetAsync(root + "/presence")).StatusCode);
    }
}
