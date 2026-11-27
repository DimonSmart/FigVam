using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using FigVam.Server.Mcp;
using ModelContextProtocol.Client;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class McpTunnelProtocolTests
{
    [Fact]
    public async Task TunnelDiscoversToolsWithoutGrantAndOnlyOperatesOnExplicitSelection()
    {
        using var signingKey = RSA.Create(2048);
        var config = ServerTestIdentity.Production(signingKey);
        var key = "fvmt_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        config["McpTunnel__Key"] = key;
        var directory = Path.Combine(Path.GetTempPath(), "figvam-tunnel-" + Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var foreign = Guid.NewGuid();
        string PathFor(Guid documentId) => $"/api/v1/documents/{documentId}/mcp-access";
        string TunnelFor(Guid documentId) => PathFor(documentId) + "/tunnel";

        HttpClient AsUser(ServerProcess server, string subject)
        {
            var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(signingKey, subject: subject));
            return client;
        }

        async Task<McpClient> Connect(ServerProcess server, string header, string value)
        {
            using var address = server.CreateClient();
            return await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
            {
                Endpoint = new Uri(address.BaseAddress!, "/mcp"),
                TransportMode = HttpTransportMode.StreamableHttp,
                AdditionalHeaders = new Dictionary<string, string> { [header] = value }
            }));
        }

        async Task<JsonElement> Call(McpClient client, string name, object? args = null, bool error = false)
        {
            var values = JsonSerializer.SerializeToElement(args ?? new { }).EnumerateObject()
                .ToDictionary(p => p.Name, p => (object?)p.Value);
            var result = await client.CallToolAsync(name, values);
            Assert.Equal(error, result.IsError == true);
            return result.StructuredContent!.Value;
        }

        async Task Denied(McpClient client)
        {
            Assert.Equal("MCP_TUNNEL_ACCESS_REQUIRED", (await Call(client, "get_document", error: true)).GetProperty("code").GetString());
            Assert.Equal("MCP_TUNNEL_ACCESS_REQUIRED", (await Call(client, "create_page", error: true)).GetProperty("code").GetString());
        }

        await using (var server = new ServerProcess(config))
        {
            await server.WaitUntilReadyAsync();
            using var alice = AsUser(server, "alice");
            using var bob = AsUser(server, "bob");
            using var editor = AsUser(server, "editor");
            foreach (var (client, documentId, name) in new[] { (alice, a, "A"), (alice, b, "B"), (bob, foreign, "Foreign") })
                (await client.PostAsJsonAsync("/api/v1/documents", new { documentId, name })).EnsureSuccessStatusCode();

            using var unauthenticated = server.CreateClient();
            unauthenticated.DefaultRequestHeaders.Add(McpTunnelCredential.Header, "fvmt_" + new string('0', 64));
            Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.GetAsync("/mcp")).StatusCode);
            unauthenticated.DefaultRequestHeaders.Remove(McpTunnelCredential.Header);
            unauthenticated.DefaultRequestHeaders.Authorization = new("Bearer", key);
            Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.GetAsync("/mcp")).StatusCode);
            unauthenticated.DefaultRequestHeaders.Authorization = null;
            unauthenticated.DefaultRequestHeaders.Add(McpTunnelCredential.Header, key);
            Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.GetAsync("/api/v1/documents")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.PostAsync(TunnelFor(a), null)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.DeleteAsync(TunnelFor(a))).StatusCode);
            using var wrongOrigin = new HttpRequestMessage(HttpMethod.Get, "/mcp");
            wrongOrigin.Headers.Add("Origin", "https://untrusted.example");
            Assert.Equal(HttpStatusCode.Forbidden, (await unauthenticated.SendAsync(wrongOrigin)).StatusCode);

            await using var mcp = await Connect(server, McpTunnelCredential.Header, key);
            Assert.Equal(37, (await mcp.ListToolsAsync()).Count);
            await Denied(mcp);
            var status = await alice.GetFromJsonAsync<JsonElement>(PathFor(a));
            Assert.True(status.GetProperty("tunnel").GetProperty("configured").GetBoolean());
            Assert.False(status.GetProperty("tunnel").GetProperty("enabled").GetBoolean());

            using var grant = await alice.PostAsync(TunnelFor(a), null);
            grant.EnsureSuccessStatusCode();
            Assert.True(grant.Headers.CacheControl?.NoStore == true);
            var selected = await grant.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(selected.GetProperty("enabled").GetBoolean());
            Assert.False(selected.TryGetProperty("token", out _));
            (await alice.PostAsync(TunnelFor(a), null)).EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.Conflict, (await alice.PostAsync(TunnelFor(b), null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await bob.PostAsync(TunnelFor(foreign), null)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await bob.PostAsync(TunnelFor(a), null)).StatusCode);
            (await bob.DeleteAsync(TunnelFor(a))).EnsureSuccessStatusCode();
            (await alice.DeleteAsync(TunnelFor(b))).EnsureSuccessStatusCode();
            Assert.Equal(a, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
            var pageA = (await Call(mcp, "create_page")).GetProperty("pageId").GetGuid();

            using var directGrant = await alice.PostAsync(PathFor(b), null);
            directGrant.EnsureSuccessStatusCode();
            var directToken = (await directGrant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
            await using var direct = await Connect(server, "Authorization", "Bearer " + directToken);
            Assert.Equal(b, (await Call(direct, "get_document")).GetProperty("documentId").GetGuid());
            var pageB = (await Call(direct, "create_page")).GetProperty("pageId").GetGuid();
            await Call(mcp, "create_screen", new { pageId = pageB, width = 800, height = 600 }, error: true);
            (await alice.DeleteAsync(TunnelFor(a))).EnsureSuccessStatusCode();
            await Denied(mcp);
            Assert.Equal(b, (await Call(direct, "get_document")).GetProperty("documentId").GetGuid());

            (await alice.PostAsync(TunnelFor(b), null)).EnsureSuccessStatusCode();
            Assert.Equal(b, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
            await Call(mcp, "create_screen", new { pageId = pageA, width = 800, height = 600 }, error: true);
            (await alice.DeleteAsync(PathFor(b))).EnsureSuccessStatusCode();
            Assert.Equal(b, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
            (await alice.DeleteAsync(TunnelFor(b))).EnsureSuccessStatusCode();

            var members = $"/api/v1/documents/{b}/members";
            (await alice.PutAsJsonAsync(members, new { memberId = "editor", role = "Viewer" })).EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsync(TunnelFor(b), null)).StatusCode);
            (await alice.PutAsJsonAsync(members, new { memberId = "editor", role = "Editor" })).EnsureSuccessStatusCode();
            (await editor.PostAsync(TunnelFor(b), null)).EnsureSuccessStatusCode();
            Assert.Equal(b, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
            await Call(mcp, "create_page");
            var history = await alice.GetFromJsonAsync<JsonElement>($"/api/v1/documents/{b}/reconnect?lastSeenRevision=0");
            Assert.Contains(history.GetProperty("events").EnumerateArray(), e =>
                e.GetProperty("source").GetString() == "MCP" && e.GetProperty("actorId").GetString() == "editor");
            (await alice.PutAsJsonAsync(members, new { memberId = "editor", role = "Viewer" })).EnsureSuccessStatusCode();
            (await alice.PutAsJsonAsync(members, new { memberId = "editor", role = "Editor" })).EnsureSuccessStatusCode();
            await Denied(mcp);
            (await editor.PostAsync(TunnelFor(b), null)).EnsureSuccessStatusCode();
            (await alice.DeleteAsync(members + "/editor")).EnsureSuccessStatusCode();
            await Denied(mcp);

            (await bob.PostAsync(TunnelFor(foreign), null)).EnsureSuccessStatusCode();
            var revision = (await Call(mcp, "get_document")).GetProperty("revision").GetInt64();
            (await bob.PostAsJsonAsync($"/api/v1/documents/{foreign}/commands/delete-document",
                new { commandId = Guid.NewGuid(), expectedRevision = revision })).EnsureSuccessStatusCode();
            await Denied(mcp);
            (await alice.PostAsync(TunnelFor(a), null)).EnsureSuccessStatusCode();
            Assert.Equal(a, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
            Assert.False(server.LogContains(key), "Tunnel service credential appeared in server logs.");
            foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
                Assert.False(System.Text.Encoding.UTF8.GetString(await File.ReadAllBytesAsync(file)).Contains(key, StringComparison.Ordinal),
                    "Tunnel credential persisted on disk.");
        }
        // The same AppHost service key can reconnect after a server restart, but it does not restore a grant.
        await using (var restarted = new ServerProcess(config))
        {
            await restarted.WaitUntilReadyAsync();
            await using var mcp = await Connect(restarted, McpTunnelCredential.Header, key);
            Assert.Equal(37, (await mcp.ListToolsAsync()).Count);
            await Denied(mcp);
            using var alice = AsUser(restarted, "alice");
            var status = await alice.GetFromJsonAsync<JsonElement>(PathFor(a));
            Assert.False(status.GetProperty("tunnel").GetProperty("enabled").GetBoolean());
            (await alice.PostAsync(TunnelFor(a), null)).EnsureSuccessStatusCode();
            Assert.Equal(a, (await Call(mcp, "get_document")).GetProperty("documentId").GetGuid());
        }
    }

    [Fact]
    public async Task UnconfiguredServerDoesNotAcceptTunnelCredentialsOrGrants()
    {
        using var signingKey = RSA.Create(2048);
        var config = ServerTestIdentity.Production(signingKey);
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var owner = server.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(signingKey));
        var doc = Guid.NewGuid();
        (await owner.PostAsJsonAsync("/api/v1/documents", new { documentId = doc, name = "No tunnel" })).EnsureSuccessStatusCode();
        var path = $"/api/v1/documents/{doc}/mcp-access";
        Assert.False((await owner.GetFromJsonAsync<JsonElement>(path)).GetProperty("tunnel").GetProperty("configured").GetBoolean());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await owner.PostAsync(path + "/tunnel", null)).StatusCode);
        using var transport = server.CreateClient();
        transport.DefaultRequestHeaders.Add(McpTunnelCredential.Header, "fvmt_" + new string('A', 64));
        Assert.Equal(HttpStatusCode.Unauthorized, (await transport.GetAsync("/mcp")).StatusCode);
    }
}
