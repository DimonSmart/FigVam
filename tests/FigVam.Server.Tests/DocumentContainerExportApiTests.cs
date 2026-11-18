using System.IO.Compression;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentContainerExportApiTests
{
    [Fact]
    public async Task DownloadSupportsSelectorsAndEnforcesPermissions()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-container-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid();
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var route = $"/api/v1/documents/{id}/container.figvam";
            using var response = await client.GetAsync(route + "?revision=0");
            Assert.Equal(200, (int)response.StatusCode);
            Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
            Assert.Contains("document.figvam", response.Content.Headers.ContentDisposition!.ToString());
            var first = await response.Content.ReadAsByteArrayAsync();
            Assert.Equal(first, await client.GetByteArrayAsync(route + "?revision=0"));
            Assert.Equal(200, (int)(await client.GetAsync("/api/v1/schemas/manifest-v1.json")).StatusCode);
            Assert.Equal(400, (int)(await client.GetAsync(route + "?revision=0&revision=0")).StatusCode);
            Assert.Equal(400, (int)(await client.GetAsync(route + "?revision=0&versionId=" + Guid.NewGuid())).StatusCode);
            using var savedResponse = await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/save", new { commandId = Guid.NewGuid(), name = "Review" });
            var version = JsonNode.Parse(await savedResponse.Content.ReadAsStringAsync())!["versionId"]!.GetValue<Guid>();
            using var zip = new ZipArchive(new MemoryStream(await client.GetByteArrayAsync(route + "?versionId=" + version)));
            using var stream = zip.GetEntry("document.json")!.Open();
            Assert.Equal(version, JsonNode.Parse(stream)!["savedVersion"]!["id"]!.GetValue<Guid>());
            Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            using var forbidden = await client.GetAsync(route);
            Assert.Equal(403, (int)forbidden.StatusCode);
            Assert.Contains("FORBIDDEN", await forbidden.Content.ReadAsStringAsync());
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        }
        finally { Directory.Delete(directory, true); }
    }
}
