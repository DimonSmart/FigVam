using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ScreenDeletionApiTests
{
    [Fact]
    public async Task DeleteScreenApiDocumentsRequiredRevisionAndPreservesHistoricalReads()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        config["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-screen-delete-api", Guid.NewGuid().ToString("N"));
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string actor) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
        Actor("owner");
        var doc = Guid.NewGuid(); var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var root = $"/api/v1/documents/{doc}";
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-page", new { commandId = Guid.NewGuid(), pageId = page })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen", new { commandId = Guid.NewGuid(), pageId = page, screenId = screen, dimensions = new { width = 10, height = 20 } })).StatusCode);
        var commandId = Guid.NewGuid(); var body = new { commandId, screenId = screen, expectedRevision = 2 };
        Actor("viewer"); Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/delete-screen", body)).StatusCode);
        Actor("owner");
        Assert.Equal(400, (int)(await client.PostAsJsonAsync(root + "/commands/delete-screen", new { commandId, screenId = screen })).StatusCode);
        using var stale = await client.PostAsJsonAsync(root + "/commands/delete-screen", new { commandId = Guid.NewGuid(), screenId = screen, expectedRevision = 1 });
        Assert.Equal(409, (int)stale.StatusCode); Assert.Equal("REVISION_CONFLICT", (await stale.Content.ReadFromJsonAsync<ApiError>())!.Code);
        using var deleted = await client.PostAsJsonAsync(root + "/commands/delete-screen", body);
        Assert.Equal(200, (int)deleted.StatusCode); var result = (await deleted.Content.ReadFromJsonAsync<CommandResponse>())!;
        Assert.Equal(3, result.Revision); Assert.Equal(new[] { page, screen }.Order(), result.AffectedIds.Order());
        using var repeated = await client.PostAsJsonAsync(root + "/commands/delete-screen", body);
        Assert.Equal(3, (await repeated.Content.ReadFromJsonAsync<CommandResponse>())!.Revision);
        Actor("viewer");
        Assert.Equal(404, (int)(await client.GetAsync(root + $"/screens/{screen}")).StatusCode);
        Assert.Equal(200, (int)(await client.GetAsync(root + $"/pages/{page}?revision=2")).StatusCode);
        Assert.Equal(200, (int)(await client.GetAsync(root + $"/screens/{screen}?revision=2")).StatusCode);
        using var schemaJson = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DeleteScreenRequest.json"));
        var schema = JsonSchema.Build(schemaJson.RootElement.Clone());
        Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(body)!).IsValid);
        Assert.False(schema.EvaluateNode(JsonSerializer.SerializeToNode(new { commandId, screenId = screen })!).IsValid);
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/delete-screen"]);
        Actor("owner");
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/undo", new { commandId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(200, (int)(await client.GetAsync(root + $"/screens/{screen}")).StatusCode);
    }
}
