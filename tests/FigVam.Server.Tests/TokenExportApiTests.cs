using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class TokenExportApiTests
{
    [Fact]
    public async Task ExportIsDocumentedSchemaValidAndEnforcesAuthorization()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-export-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config);
            await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid();
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var route = $"/api/v1/documents/{id}/token-export";
            Assert.Equal(400, (int)(await client.GetAsync(route)).StatusCode);
            using var response = await client.GetAsync(route + "?theme=Light&revision=0");
            Assert.Equal(200, (int)response.StatusCode);
            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
            using var schemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/TokenExportResponse.json"));
            Assert.True(JsonSchema.Build(schemaDoc.RootElement.Clone()).EvaluateNode(body).IsValid);
            Assert.Contains("token-export", await client.GetStringAsync("/openapi/v1.json"));
            Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.GetAsync(route + "?theme=Light")).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "outsider"));
            Assert.Equal(403, (int)(await client.GetAsync(route + "?theme=Dark")).StatusCode);
        }
        finally { Directory.Delete(directory, true); }
    }
}
