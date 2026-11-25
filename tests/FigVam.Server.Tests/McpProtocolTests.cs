using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using ModelContextProtocol.Client;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class McpProtocolTests
{
    [Fact]
    public async Task OfficialClientEditsOnlyGrantedDocumentAndRevocationSurvivesReconnect()
    {
        using var key = RSA.Create(2048);
        var config = ServerTestIdentity.Production(key);
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var user = server.CreateClient();
        user.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        var documentId = Guid.NewGuid();
        var foreignId = Guid.NewGuid();
        foreach (var id in new[] { documentId, foreignId })
            (await user.PostAsJsonAsync("/api/v1/documents", new { documentId = id, name = "MCP test" })).EnsureSuccessStatusCode();
        var grantPath = $"/api/v1/documents/{documentId}/mcp-access";
        using var grant = await user.PostAsync(grantPath, null);
        grant.EnsureSuccessStatusCode();
        Assert.True(grant.Headers.CacheControl?.NoStore);
        var access = await grant.Content.ReadFromJsonAsync<JsonElement>();
        var token = access.GetProperty("token").GetString()!;
        var endpoint = new Uri(access.GetProperty("endpoint").GetString()!);
        await using var mcp = await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = endpoint,
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + token }
        }));
        var tools = await mcp.ListToolsAsync();
        Assert.Equal(30, tools.Count);
        async Task<JsonElement> Call(string name, object? args = null, bool error = false)
        {
            var values = JsonSerializer.SerializeToElement(args ?? new { }).EnumerateObject()
                .ToDictionary(p => p.Name, p => (object?)p.Value);
            var result = await mcp.CallToolAsync(name, values);
            Assert.Equal(error, result.IsError == true);
            return result.StructuredContent!.Value;
        }
        var doc = await Call("get_document");
        Assert.Equal(documentId, doc.GetProperty("documentId").GetGuid());
        var commandId = Guid.NewGuid();
        var page = await Call("create_page", new { commandId });
        Assert.Equal(page.GetRawText(), (await Call("create_page", new { commandId })).GetRawText());
        var pageId = page.GetProperty("pageId").GetGuid();
        await Call("rename_page", new { pageId, name = "Login" });
        var screenId = (await Call("create_screen", new { pageId, width = 800, height = 600 })).GetProperty("screenId").GetGuid();
        await Call("rename_screen", new { screenId, name = "Login" });
        await Call("resize_screen", new { screenId, width = 810, height = 610 });
        var nodeId = (await Call("create_node", new { parentId = screenId, kind = "Button", properties = new { text = "Login", width = 120, height = 40, backgroundColor = "#2563EB" } })).GetProperty("nodeId").GetGuid();
        await Call("rename_node", new { nodeId, name = "Login button" });
        var updated = await Call("set_node_properties", new { nodeId, properties = new { text = "Sign in" } });
        var revision = updated.GetProperty("revision").GetInt64();
        await Call("set_node_properties", new { nodeId, expectedRevision = revision - 1, properties = new { text = "stale" } }, true);
        await Call("set_node_properties", new { nodeId, properties = new { text = "invalid", width = "bad" } }, true);
        Assert.Equal(revision, (await Call("get_document")).GetProperty("revision").GetInt64());
        await Call("remove_node_properties", new { nodeId, properties = new[] { "backgroundColor" }, expectedRevision = revision });
        var tokenId = (await Call("create_token", new { name = "spacing.dialog", type = "Spacing", light = 32, dark = 32 })).GetProperty("tokenId").GetGuid();
        await Call("set_token_value", new { tokenId, theme = "Dark", value = 24 });
        var duplicate = await Call("duplicate_screen", new { screenId, expectedRevision = (await Call("get_document")).GetProperty("revision").GetInt64() });
        var target = duplicate.GetProperty("screenId").GetGuid();
        var actions = new[] { new { type = "navigate", screenId = target } };
        var scenario = await Call("create_scenario", new { screenId, nodeId, @event = "Click", actions });
        var scenarioId = scenario.GetProperty("scenarioId").GetGuid();
        var updatedScenario = await Call("update_scenario", new { scenarioId, screenId, nodeId, @event = "Click", actions, expectedRevision = scenario.GetProperty("revision").GetInt64() });
        await Call("list_scenarios", new { screenId });
        await Call("delete_scenario", new { scenarioId, expectedRevision = updatedScenario.GetProperty("revision").GetInt64() });
        await Call("list_pages");
        await Call("list_screens", new { pageId });
        await Call("get_screen", new { screenId });
        await Call("get_node", new { nodeId });
        await Call("list_children", new { parentId = screenId });
        await Call("get_screen_tree", new { screenId });
        await Call("list_node_types");
        await Call("get_node_schema", new { kind = "Button" });
        await Call("list_tokens");
        await Call("get_screen_layout", new { screenId });
        await Call("delete_node", new { nodeId });
        await Call("save_version", new { name = "MCP milestone" });

        using var foreignGrant = await user.PostAsync($"/api/v1/documents/{foreignId}/mcp-access", null);
        foreignGrant.EnsureSuccessStatusCode();
        var foreignToken = (await foreignGrant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        await using var other = await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = endpoint, TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + foreignToken }
        }));
        var foreignPage = (await other.CallToolAsync("create_page", new Dictionary<string, object?>())).StructuredContent!.Value.GetProperty("pageId").GetGuid();
        await Call("list_screens", new { pageId = foreignPage }, true);
        await Call("create_screen", new { pageId = foreignPage, width = 800, height = 600 }, true);
        using var unauthorized = server.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/mcp")).StatusCode);
        unauthorized.DefaultRequestHeaders.Authorization = new("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync(grantPath)).StatusCode);
        using var wrongOrigin = new HttpRequestMessage(HttpMethod.Get, "/mcp");
        wrongOrigin.Headers.Add("Origin", "https://untrusted.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await unauthorized.SendAsync(wrongOrigin)).StatusCode);
        (await user.DeleteAsync(grantPath)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/mcp")).StatusCode);
        var disabled = await user.GetFromJsonAsync<JsonElement>(grantPath);
        Assert.False(disabled.GetProperty("enabled").GetBoolean());
    }
}
