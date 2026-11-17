using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class CommandApiTests
{
    [Fact]
    public async Task CommandsRespectAuthorizationIdempotencyAndDocumentBoundaries()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-command-api", Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string actor) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
        Actor("owner");
        var doc = Guid.NewGuid(); var other = Guid.NewGuid(); var page = Guid.NewGuid(); var screen = Guid.NewGuid();
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = other })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        var root = $"/api/v1/documents/{doc}/commands/";
        var commandId = Guid.NewGuid();
        async Task<CommandResponse> Success(string route, object body, long revision)
        {
            using var response = await client.PostAsJsonAsync(root + route, body);
            Assert.Equal(200, (int)response.StatusCode);
            var result = (await response.Content.ReadFromJsonAsync<CommandResponse>())!;
            Assert.Equal("ACCEPTED", result.Status); Assert.Equal(revision, result.Revision); return result;
        }
        async Task Refused(string route, object body, int status, string code)
        {
            using var response = await client.PostAsJsonAsync(root + route, body);
            Assert.Equal(status, (int)response.StatusCode);
            Assert.Equal(code, (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        var first = await Success("add-page", new { commandId, pageId = page }, 1);
        var repeated = await Success("add-page", new { commandId, pageId = Guid.NewGuid() }, 1);
        Assert.Equal(first.PageId, repeated.PageId); Assert.Equal(first.AffectedIds, repeated.AffectedIds);
        await Success("add-screen", new { commandId = Guid.NewGuid(), pageId = page, screenId = screen }, 2);
        await Refused("add-node", new { commandId = Guid.NewGuid(), parentId = screen, nodeId = Guid.NewGuid(), kind = "Frame" }, 400, "UNSUPPORTED_NODE_KIND");
        await Refused("delete-node", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid() }, 404, "NODE_NOT_FOUND");
        await Refused("move-node", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), expectedParentId = screen, targetParentId = screen, position = 0 }, 404, "NODE_NOT_FOUND");
        await Refused("set-node-property", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), property = "width", value = new { type = "number", value = 1 } }, 404, "NODE_NOT_FOUND");
        await Refused("set-node-name", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), name = "Button" }, 404, "NODE_NOT_FOUND");
        await Refused("set-node-semantic-key", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), semanticKey = (string?)null }, 404, "NODE_NOT_FOUND");
        var saved = await Success("save", new { commandId = Guid.NewGuid(), name = "checkpoint" }, 3);
        await Success("restore", new { commandId = Guid.NewGuid(), versionId = saved.VersionId }, 4);
        await Success("undo", new { commandId = Guid.NewGuid() }, 5);
        await Success("redo", new { commandId = Guid.NewGuid() }, 6);
        Actor("viewer");
        await Refused("add-page", new { commandId = Guid.NewGuid(), pageId = Guid.NewGuid() }, 403, "FORBIDDEN");
        await Refused("set-node-name", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), name = "Button" }, 403, "FORBIDDEN");
        await Refused("set-node-semantic-key", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), semanticKey = "submit" }, 403, "FORBIDDEN");
        Actor("owner");
        await Refused("add-screen", new { commandId = Guid.NewGuid(), pageId = Guid.NewGuid(), screenId = Guid.NewGuid() }, 404, "PAGE_NOT_FOUND");
        using var cross = await client.PostAsJsonAsync($"/api/v1/documents/{other}/commands/restore", new { commandId = Guid.NewGuid(), versionId = saved.VersionId });
        Assert.Equal(404, (int)cross.StatusCode);
        using var invalid = await client.PostAsync(root + "add-page", new StringContent($"{{\"commandId\":\"{Guid.NewGuid()}\",\"pageId\":\"{Guid.NewGuid()}\",\"actorId\":\"spoofed\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(400, (int)invalid.StatusCode);
        using var oversized = await client.PostAsync(root + "save", new StringContent(new string(' ', 17000) + "{}", Encoding.UTF8, "application/json"));
        Assert.Equal(413, (int)oversized.StatusCode);
        var storage = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
        Assert.Equal(6, (await storage.ReadAsync(doc))!.Revision);
        Assert.Equal(0, (await storage.ReadAsync(other))!.Revision);
    }

    [Fact]
    public async Task CommandSchemasAndOpenApiDescribeRequestsAndResponses()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(Production(key));
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        foreach (var route in new[] { "add-token", "add-page", "add-screen", "add-node", "delete-node", "move-node", "set-node-property", "set-node-name", "set-node-semantic-key", "save", "restore", "undo", "redo" })
        {
            var operation = api["paths"]![$"/api/v1/documents/{{documentId}}/commands/{route}"]!["post"]!;
            Assert.NotNull(operation["security"]![0]!["Bearer"]);
            Assert.Contains("CommandResponse", operation["responses"]!["200"]!.ToJsonString());
            Assert.Contains("ApiError", operation["responses"]!["409"]!.ToJsonString());
        }
        foreach (var type in new[] { typeof(AddTokenRequest), typeof(AddPageRequest), typeof(AddScreenRequest), typeof(AddNodeRequest), typeof(DeleteNodeRequest), typeof(MoveNodeRequest), typeof(SetNodePropertyRequest), typeof(SetNodeNameRequest), typeof(SetNodeSemanticKeyRequest), typeof(SaveDocumentRequest), typeof(RestoreDocumentRequest), typeof(HistoryCommandRequest), typeof(CommandResponse) })
        {
            var schema = JsonNode.Parse(await client.GetStringAsync($"/api/v1/schemas/{type.Name}.json"))!;
            Assert.Equal(api["components"]!["schemas"]![type.Name]!["properties"]!.AsObject().Select(x => x.Key).Order(), schema["properties"]!.AsObject().Select(x => x.Key).Order());
            Assert.DoesNotContain("actorId", schema.ToJsonString());
        }
        using var document = System.Text.Json.JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddPageRequest.json"));
        var contract = JsonSchema.Build(document.RootElement.Clone());
        Assert.True(contract.EvaluateNode(JsonNode.Parse($"{{\"commandId\":\"{Guid.NewGuid()}\",\"pageId\":\"{Guid.NewGuid()}\"}}")!).IsValid);
        Assert.False(contract.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
    }
}

