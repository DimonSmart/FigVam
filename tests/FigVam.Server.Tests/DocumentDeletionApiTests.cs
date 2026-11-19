using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentDeletionApiTests
{
    [Fact]
    public async Task HeadlessDeleteContractsAndInaccessibilitySurviveServerRestart()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-delete-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        var doc = Guid.NewGuid(); var root = $"/api/v1/documents/{doc}";
        var commandId = Guid.NewGuid(); var body = new { commandId, expectedRevision = 1 };
        CommandResponse accepted;
        Guid versionId;
        await using (var server = new ServerProcess(config))
        {
            await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
            void Actor(string actor) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
            Actor("owner");
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
            foreach (var role in new[] { "Editor", "Viewer" })
                Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = role.ToLowerInvariant(), role })).StatusCode);
            using var saved = await client.PostAsJsonAsync(root + "/commands/save", new { commandId = Guid.NewGuid() });
            versionId = (await saved.Content.ReadFromJsonAsync<CommandResponse>())!.VersionId!.Value;
            foreach (var actor in new[] { "editor", "viewer", "outsider" })
            {
                Actor(actor); Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/delete-document", body)).StatusCode);
            }
            Actor("owner");
            foreach (var invalid in new object[] { new { commandId }, new { commandId, expectedRevision = -1 }, new { commandId, expectedRevision = 1, actorId = "other" } })
                Assert.Equal(400, (int)(await client.PostAsJsonAsync(root + "/commands/delete-document", invalid)).StatusCode);
            using var stale = await client.PostAsJsonAsync(root + "/commands/delete-document", new { commandId = Guid.NewGuid(), expectedRevision = 0 });
            Assert.Equal(409, (int)stale.StatusCode); Assert.Equal("REVISION_CONFLICT", (await stale.Content.ReadFromJsonAsync<ApiError>())!.Code);
            using var schemaJson = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DeleteDocumentRequest.json"));
            var schema = JsonSchema.Build(schemaJson.RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(body)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonSerializer.SerializeToNode(new { commandId })!).IsValid);
            var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
            Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/delete-document"]);
            using var deleted = await client.PostAsJsonAsync(root + "/commands/delete-document", body);
            Assert.Equal(200, (int)deleted.StatusCode); accepted = (await deleted.Content.ReadFromJsonAsync<CommandResponse>())!;
            Assert.Equal(2, accepted.Revision); Assert.Equal(new[] { doc }, accepted.AffectedIds);
        }
        await using (var restarted = new ServerProcess(config))
        {
            await restarted.WaitUntilReadyAsync(); using var client = restarted.CreateClient();
            void Actor(string actor) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
            Actor("owner");
            using var retry = await client.PostAsJsonAsync(root + "/commands/delete-document", body);
            Assert.Equal(200, (int)retry.StatusCode); var result = (await retry.Content.ReadFromJsonAsync<CommandResponse>())!;
            Assert.Equal(accepted.Revision, result.Revision); Assert.Equal(accepted.CommandId, result.CommandId);
            foreach (var actor in new[] { "owner", "editor", "viewer", "outsider" })
            {
                Actor(actor);
                foreach (var path in new[] { "/pages", "/pages?revision=0", "/versions", "/document.json", "/document.json?revision=0", $"/document.json?versionId={versionId}", "/container.figvam", "/reconnect?lastSeenRevision=0", "/events?lastSeenRevision=0", "/presence" })
                    Assert.Equal(403, (int)(await client.GetAsync(root + path)).StatusCode);
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/rename-document", new { commandId = Guid.NewGuid(), name = "Revive" })).StatusCode);
            }
            Actor("editor"); Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/delete-document", body)).StatusCode);
            Actor("owner"); Assert.Equal(404, (int)(await client.PostAsJsonAsync(root + "/commands/delete-document", new { commandId = Guid.NewGuid(), expectedRevision = 2 })).StatusCode);
        }
        Directory.Delete(directory, true);
    }
}
