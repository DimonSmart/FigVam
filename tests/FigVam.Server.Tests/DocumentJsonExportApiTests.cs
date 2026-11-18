using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentJsonExportApiTests
{
    [Fact]
    public async Task DownloadPublishesSchemaAndOpenApiWithRevisionVersionAndPermissionChecks()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-json-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config);
            await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid();
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var route = $"/api/v1/documents/{id}/document.json";
            using var response = await client.GetAsync(route + "?revision=0");
            Assert.Equal(200, (int)response.StatusCode);
            Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
            Assert.Contains("document.json", response.Content.Headers.ContentDisposition!.ToString());
            var body = await response.Content.ReadAsByteArrayAsync();
            Assert.Equal(body, await client.GetByteArrayAsync(route + "?revision=0"));
            using var schemaDocument = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/document-v1.json"));
            Assert.True(JsonSchema.Build(schemaDocument.RootElement.Clone(), new BuildOptions { SchemaRegistry = new SchemaRegistry() }).EvaluateNode(JsonNode.Parse(body)!).IsValid);
            Assert.Contains("/document.json", await client.GetStringAsync("/openapi/v1.json"));
            using var savedResponse = await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/save", new { commandId = Guid.NewGuid(), name = "Review" });
            Assert.Equal(200, (int)savedResponse.StatusCode);
            var savedId = JsonNode.Parse(await savedResponse.Content.ReadAsStringAsync())!["versionId"]!.GetValue<Guid>();
            var savedBody = JsonNode.Parse(await client.GetByteArrayAsync(route + "?versionId=" + savedId))!;
            Assert.Equal(savedId, savedBody["savedVersion"]!["id"]!.GetValue<Guid>());
            Assert.Equal("Review", savedBody["savedVersion"]!["name"]!.GetValue<string>());
            Assert.Equal(body, await client.GetByteArrayAsync(route + "?revision=0"));
            foreach (var query in new[] { "revision=0&versionId=" + Guid.NewGuid(), "revision=0&revision=0", "unknown=true", "versionId=invalid", "revision=-1" })
                Assert.Equal(400, (int)(await client.GetAsync(route + "?" + query)).StatusCode);
            Assert.Equal(400, (int)(await client.GetAsync(route + "?revision=123")).StatusCode);
            Assert.Equal(404, (int)(await client.GetAsync(route + "?versionId=" + Guid.NewGuid())).StatusCode);
            Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
            foreach (var actor in new[] { "viewer", "outsider" })
            {
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
                Assert.Equal(403, (int)(await client.GetAsync(route)).StatusCode);
                Assert.Equal(403, (int)(await client.GetAsync(route + "?versionId=" + Guid.NewGuid())).StatusCode);
            }
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        }
        finally { Directory.Delete(directory, true); }
    }
}
