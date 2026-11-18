using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentFileImportApiTests
{
    [Fact]
    public async Task AuthenticatedRawImportsValidatePersistAndPublishContracts()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-import-api-" + Guid.NewGuid());
        config["Storage__Directory"] = directory;
        var ids = new List<Guid>();
        try
        {
            await using (var server = new ServerProcess(config))
            {
                await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
                foreach (var format in new[] { DocumentFileFormat.Json, DocumentFileFormat.FigVam })
                {
                    var id = Guid.NewGuid(); ids.Add(id);
                    var source = new DocumentJsonExport(1, 9, new(Guid.NewGuid(), "Source", DateTimeOffset.UtcNow, "source-owner", 9),
                        new DocumentStructure(id, [new(Guid.NewGuid(), []) { Name = "Page" }], [], [])
                        { Datasets = [new(Guid.NewGuid(), "Fixture", "\"" + new string('x', 20000) + "\"")] });
                    var bytes = await DocumentFileImportTests.File(source, format);
                    var path = "/api/v1/documents/import/" + (format == DocumentFileFormat.Json ? "document.json" : "container.figvam");
                    var type = format == DocumentFileFormat.Json ? "application/json" : "application/zip";
                    client.DefaultRequestHeaders.Authorization = null;
                    Assert.Equal(401, (int)(await Post(client, path, bytes, type)).StatusCode);
                    Assert.False(System.IO.File.Exists(Path.Combine(directory, $"{id:N}.sqlite")));
                    client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "importer"));
                    using var accepted = await Post(client, path, bytes, type);
                    Assert.Equal(201, (int)accepted.StatusCode);
                    var response = await accepted.Content.ReadFromJsonAsync<DocumentImportResponse>();
                    Assert.Equal(id, response!.DocumentId); Assert.Equal(0, response.Revision);
                    Validate(nameof(DocumentImportResponse), JsonNode.Parse(await accepted.Content.ReadAsStringAsync())!);
                    var actual = await client.GetByteArrayAsync($"/api/v1/documents/{id}/document.json");
                    Assert.Equal(DocumentJsonFormat.Serialize(source with { Revision = 0, SavedVersion = null }), actual);
                    Assert.Equal(409, (int)(await Post(client, path, bytes, type)).StatusCode);
                    client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "outsider"));
                    Assert.Equal(409, (int)(await Post(client, path, bytes, type)).StatusCode);
                    Assert.Equal(403, (int)(await client.GetAsync($"/api/v1/documents/{id}/document.json")).StatusCode);
                    client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "importer"));
                    Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "reviewer", role = "Viewer" })).StatusCode);
                    Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/add-page", new { commandId = Guid.NewGuid(), pageId = Guid.NewGuid() })).StatusCode);
                }
                foreach (var (path, bytes, type, expectedCode) in new[] {
                    ("document.json", Encoding.UTF8.GetBytes("{"), "application/json", "INVALID_JSON"),
                    ("document.json", Encoding.UTF8.GetBytes("{\"schemaVersion\":2}"), "application/json", "UNSUPPORTED_SCHEMA_VERSION"),
                    ("container.figvam", new byte[] { 1, 2, 3 }, "application/zip", "INVALID_CONTAINER") })
                {
                    using var invalid = await Post(client, "/api/v1/documents/import/" + path, bytes, type);
                    Assert.Equal(400, (int)invalid.StatusCode);
                    var failure = await invalid.Content.ReadFromJsonAsync<DocumentImportFailure>();
                    Assert.Equal("INVALID_DOCUMENT_FILE", failure!.Code); Assert.Contains(failure.Diagnostics, d => d.Code == expectedCode);
                    Validate(nameof(DocumentImportFailure), JsonNode.Parse(await invalid.Content.ReadAsStringAsync())!);
                }
                Assert.Equal(415, (int)(await Post(client, "/api/v1/documents/import/document.json", [], "text/plain")).StatusCode);
                Assert.Equal(413, (int)(await Post(client, "/api/v1/documents/import/document.json", new byte[DocumentJsonFormat.MaxBytes + 1], "application/json")).StatusCode);
                Assert.Equal(413, (int)(await Post(client, "/api/v1/documents/import/container.figvam", new byte[DocumentFileReader.MaxContainerBytes + 1], "application/zip")).StatusCode);
                Assert.Equal(2, Directory.GetFiles(directory, "*.sqlite").Length);
                foreach (var name in new[] { nameof(DocumentImportResponse), nameof(DocumentImportFailure), nameof(DocumentReadDiagnostic) })
                    Assert.Equal(200, (int)(await client.GetAsync($"/api/v1/schemas/{name}.json")).StatusCode);
                var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
                Assert.NotNull(openapi["paths"]!["/api/v1/documents/import/document.json"]!["post"]!["requestBody"]!["content"]!["application/json"]);
                Assert.NotNull(openapi["paths"]!["/api/v1/documents/import/container.figvam"]!["post"]!["requestBody"]!["content"]!["application/zip"]);
            }
            await using var reopened = new ServerProcess(config); await reopened.WaitUntilReadyAsync();
            using var recoveredClient = reopened.CreateClient();
            recoveredClient.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "importer"));
            foreach (var id in ids)
            {
                var export = JsonNode.Parse(await recoveredClient.GetByteArrayAsync($"/api/v1/documents/{id}/document.json"))!;
                Assert.Equal(1, export["revision"]!.GetValue<long>());
                Assert.Equal(id, export["document"]!["id"]!.GetValue<Guid>());
                Assert.Equal(2, export["document"]!["pages"]!.AsArray().Count);
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, byte[] bytes, string mediaType)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        // Let the server reject oversized headers before sending a body it must discard.
        request.Headers.ExpectContinue = bytes.Length > 1024 * 1024;
        return await client.SendAsync(request);
    }
    private static void Validate(string name, JsonNode value)
    {
        var type = name == nameof(DocumentImportResponse) ? typeof(DocumentImportResponse) : typeof(DocumentImportFailure);
        var schema = JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.Create(type)),
            new BuildOptions { SchemaRegistry = new SchemaRegistry() });
        Assert.True(schema.EvaluateNode(value).IsValid);
    }
}
