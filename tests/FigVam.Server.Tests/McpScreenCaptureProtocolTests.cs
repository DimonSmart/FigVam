using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class McpScreenCaptureProtocolTests
{
    [Fact]
    public async Task ServerRendersWithoutAnEditorAndPreservesRevision()
    {
        using var key = RSA.Create(2048);
        var config = ServerTestIdentity.Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-capture-" + Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var user = server.CreateClient();
        user.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        var doc = Guid.NewGuid();
        (await user.PostAsJsonAsync("/api/v1/documents", new { documentId = doc, name = "Capture" })).EnsureSuccessStatusCode();
        var path = $"/api/v1/documents/{doc}";
        using var grant = await user.PostAsync(path + "/mcp-access", null);
        grant.EnsureSuccessStatusCode();
        var access = await grant.Content.ReadFromJsonAsync<JsonElement>();
        await using var mcp = await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(access.GetProperty("endpoint").GetString()!),
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + access.GetProperty("token").GetString() }
        }));
        async Task<CallToolResult> Call(string name, object? args = null)
        {
            var values = JsonSerializer.SerializeToElement(args ?? new { }).EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
            return await mcp.CallToolAsync(name, values);
        }
        static string? Code(CallToolResult result) => result.StructuredContent!.Value.GetProperty("code").GetString();
        var page = await Call("create_page", new { name = "Login Prototype" });
        var pageId = page.StructuredContent!.Value.GetProperty("pageId").GetGuid();
        var created = await Call("create_screen", new { pageId, width = 2, height = 1, name = "Login" });
        var screenId = created.StructuredContent!.Value.GetProperty("screenId").GetGuid();
        var revision = created.StructuredContent!.Value.GetProperty("revision").GetInt64();
        Assert.Equal("SCREEN_NOT_FOUND", Code(await Call("render_screen", new { screenId = Guid.NewGuid() })));
        Assert.Equal("RENDER_REVISION_MISMATCH", Code(await Call("render_screen", new { screenId, revision = revision - 1 })));

        Assert.Equal("INVALID_THEME", Code(await Call("render_screen", new { screenId, theme = "Sepia" })));
        var rendered = await Call("render_screen", new { screenId, revision, theme = "Dark" });
        Assert.NotEqual(true, rendered.IsError);
        var block = Assert.Single(rendered.Content.OfType<ImageContentBlock>());
        Assert.Equal("image/png", block.MimeType);
        Assert.Equal("OK", FigVam.Server.Mcp.ScreenCaptureResult.FromPng(block.DecodedData.ToArray()).Code);
        Assert.Equal(2, rendered.StructuredContent!.Value.GetProperty("width").GetInt32());
        Assert.Equal(1, rendered.StructuredContent!.Value.GetProperty("height").GetInt32());
        Assert.Equal("Dark", rendered.StructuredContent!.Value.GetProperty("theme").GetString());
        Assert.Equal(revision, rendered.StructuredContent!.Value.GetProperty("revision").GetInt64());
        Assert.Equal(revision, (await Call("get_document")).StructuredContent!.Value.GetProperty("revision").GetInt64());

        var light = await Call("render_screen", new { screenId });
        Assert.NotEqual(true, light.IsError);
        Assert.Equal("Light", light.StructuredContent!.Value.GetProperty("theme").GetString());
        Assert.NotEqual(true, (await Call("get_document")).IsError);
    }
}
