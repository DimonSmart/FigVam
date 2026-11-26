using System.Net;
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
    public async Task AuthorizedBrowserReturnsImageThroughOfficialMcpClientWithoutEditingDocument()
    {
        using var key = RSA.Create(2048);
        var config = ServerTestIdentity.Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-capture-" + Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var user = server.CreateClient();
        using var foreign = server.CreateClient();
        user.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        foreign.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "other"));
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
        Assert.Equal("RENDER_UNAVAILABLE", Code(await Call("render_screen", new { screenId })));
        Assert.Equal("RENDER_REVISION_MISMATCH", Code(await Call("render_screen", new { screenId, revision = revision - 1 })));

        using var connect = new HttpRequestMessage(HttpMethod.Post, path + "/screen-capture/providers");
        using var response = await user.SendAsync(connect, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(stream);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        async Task<JsonElement> Event(string code)
        {
            while (await reader.ReadLineAsync(deadline.Token) is { } line)
            {
                if (!line.StartsWith("data: ")) continue;
                using var json = JsonDocument.Parse(line[6..]);
                if (json.RootElement.GetProperty("code").GetString() == code) return json.RootElement.Clone();
            }
            throw new InvalidOperationException("Capture connection closed");
        }
        var providerId = (await Event("READY")).GetProperty("providerId").GetGuid();
        Assert.Equal("INVALID_THEME", Code(await Call("render_screen", new { screenId, theme = "Sepia" })));
        var call = Call("render_screen", new { screenId, revision, theme = "Dark" });
        var request = (await Event("CAPTURE")).GetProperty("request");
        Assert.Equal(revision, request.GetProperty("revision").GetInt64());
        Assert.Equal(screenId, request.GetProperty("screenId").GetGuid());
        Assert.Equal("Dark", request.GetProperty("theme").GetString());
        Assert.Equal(2, request.GetProperty("width").GetInt32());
        var url = path + "/screen-capture/providers/" + providerId + "/results/" +
            request.GetProperty("requestId").GetGuid() + "?screenId=" + screenId + "&revision=" + revision + "&theme=Dark";
        var bytes = DocumentAssetTests.Png();
        using var wrong = new ByteArrayContent(bytes);
        wrong.Headers.ContentType = new("image/png");
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.PostAsync(url, wrong)).StatusCode);
        using var image = new ByteArrayContent(bytes);
        image.Headers.ContentType = new("image/png");
        (await user.PostAsync(url, image)).EnsureSuccessStatusCode();
        var rendered = await call;
        Assert.NotEqual(true, rendered.IsError);
        var block = Assert.Single(rendered.Content.OfType<ImageContentBlock>());
        Assert.Equal("image/png", block.MimeType);
        Assert.Equal(bytes, block.DecodedData.ToArray());
        Assert.Equal(2, rendered.StructuredContent!.Value.GetProperty("width").GetInt32());
        Assert.Equal(1, rendered.StructuredContent!.Value.GetProperty("height").GetInt32());
        Assert.Equal("Dark", rendered.StructuredContent!.Value.GetProperty("theme").GetString());
        Assert.Equal(revision, rendered.StructuredContent!.Value.GetProperty("revision").GetInt64());
        Assert.Equal(revision, (await Call("get_document")).StructuredContent!.Value.GetProperty("revision").GetInt64());

        call = Call("render_screen", new { screenId });
        await Event("CAPTURE");
        (await user.DeleteAsync(path + "/screen-capture/providers/" + providerId)).EnsureSuccessStatusCode();
        Assert.Equal("RENDER_UNAVAILABLE", Code(await call));
        Assert.Equal("RENDER_UNAVAILABLE", Code(await Call("render_screen", new { screenId })));
        Assert.NotEqual(true, (await Call("get_document")).IsError);
    }
}
