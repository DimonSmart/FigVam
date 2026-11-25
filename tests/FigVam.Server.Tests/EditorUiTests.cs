using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class EditorUiTests
{
    [Fact]
    public async Task ShellAndDirectLinksArePublicButDocumentDataRetainsBearerAndMembershipChecks()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(Production(key));
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        var id = Guid.NewGuid();
        var routes = new Queue<string>(new[]
        {
            "/", $"/documents/{id}", "/editor.css", "/editor-shell.css", "/home.css", "/editor.js", "/editor-shell.js", "/api-client.js", "/canvas-viewport.js",
            "/components.js", "/datasets.js", "/document-collaboration.js", "/document-export.js", "/document-history.js", "/members.js", "/presence.js", "/layers.js", "/scenarios.js", "/screen-diagnostics.js", "/screen-resize.js", "/screen-variants.js",
            "/tokens.js", "/token-groups.js", "/session.js", "/auth-client.js", "/user-admin.js",
            "/visual-node-editor.js", "/node-property-controls.js", "/screen-renderer.js",
            "/token-value-control.js", "/token-resolution.js", "/interaction-catalog.js", "/interaction-editor.js"
        });
        var visited = new HashSet<string>(StringComparer.Ordinal);
        while (routes.TryDequeue(out var route))
        {
            if (!visited.Add(route)) continue;
            using var response = await client.GetAsync(route);
            Assert.True(response.IsSuccessStatusCode, $"{route}: {(int)response.StatusCode}");
            if (route.EndsWith(".css", StringComparison.Ordinal))
                Assert.Equal("text/css", response.Content.Headers.ContentType?.MediaType);
            if (route.EndsWith(".js", StringComparison.Ordinal))
            {
                Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
                // Recursively verify static relative imports, including modules not named in the smoke-test seed list.
                var source = await response.Content.ReadAsStringAsync();
                foreach (Match import in Regex.Matches(source, """(?m)^\s*import\s+(?:[^;]*?\s+from\s+)?['"]\./(?<module>[^'"]+\.js)['"]"""))
                    routes.Enqueue("/" + import.Groups["module"].Value);
            }
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        }
        Assert.Equal(401, (int)(await client.GetAsync($"/api/v1/documents/{id}?fields=name")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id, name = "<script>document name</script>" })).StatusCode);
        var data = JsonNode.Parse(await client.GetStringAsync($"/api/v1/documents/{id}?fields=name"))!;
        Assert.Equal("<script>document name</script>", (string?)data["items"]![0]!["name"]);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "outsider"));
        Assert.Equal(403, (int)(await client.GetAsync($"/api/v1/documents/{id}?fields=name")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(401, (int)(await client.GetAsync($"/api/v1/documents/{id}?access_token={Token(key)}")).StatusCode);
    }
}
