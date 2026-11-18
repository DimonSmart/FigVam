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
public sealed class DocumentAssetApiTests
{
    [Fact]
    public async Task RawUploadReadsPermissionsContractsAndRestart()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-asset-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        var doc = Guid.NewGuid(); var asset = Guid.NewGuid(); var command = Guid.NewGuid(); Guid version;
        var rawPixels = new byte[(128 * 3 + 1) * 128]; new Random(176).NextBytes(rawPixels);
        for (var row = 0; row < 128; row++) rawPixels[row * (128 * 3 + 1)] = 0;
        var imageBytes = DocumentAssetTests.Png(width: 128, height: 128, raw: rawPixels);
        Assert.True(imageBytes.Length > 16 * 1024);
        try
        {
            await using (var server = new ServerProcess(config))
            {
                await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
                Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
                var path = $"/api/v1/documents/{doc}/assets/{asset}";
                using var upload = await Put(client, path + "?commandId=" + command, imageBytes);
                Assert.Equal(200, (int)upload.StatusCode);
                var result = (await upload.Content.ReadFromJsonAsync<CommandResponse>())!; Assert.Equal(1, result.Revision); Assert.Equal(new[] { asset }, result.AffectedIds);
                using var retry = await Put(client, path + "?commandId=" + command, [1,2,3]);
                Assert.Equal(await upload.Content.ReadAsStringAsync(), await retry.Content.ReadAsStringAsync());
                using var image = await client.GetAsync(path);
                Assert.Equal(imageBytes, await image.Content.ReadAsByteArrayAsync()); Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType);
                Assert.Contains("no-store", image.Headers.CacheControl!.ToString()); Assert.Equal("nosniff", image.Headers.GetValues("X-Content-Type-Options").Single());
                Assert.Equal(404, (int)(await client.GetAsync(path + "?revision=0")).StatusCode);
                var manifest = JsonNode.Parse(await client.GetStringAsync($"/api/v1/documents/{doc}/assets"))!;
                var schema = JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.Create(typeof(DocumentAssetsResponse))), new BuildOptions { SchemaRegistry = new SchemaRegistry() });
                Assert.True(schema.EvaluateNode(manifest).IsValid);
                using var saved = await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/save", new { commandId = Guid.NewGuid(), name = "Image" });
                version = (await saved.Content.ReadFromJsonAsync<CommandResponse>())!.VersionId!.Value;
                Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/undo", new { commandId = Guid.NewGuid() })).StatusCode);
                Assert.Equal(404, (int)(await client.GetAsync(path)).StatusCode);
                Assert.Equal(imageBytes, await client.GetByteArrayAsync(path + "?versionId=" + version));
                Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
                Assert.Equal(200, (int)(await client.GetAsync(path + "?versionId=" + version)).StatusCode);
                Assert.Equal(403, (int)(await Put(client, path + "?commandId=" + Guid.NewGuid(), imageBytes)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "outsider"));
                Assert.Equal(403, (int)(await client.GetAsync(path + "?versionId=" + version)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
                foreach (var bytes in new[] { Encoding.UTF8.GetBytes("<svg><script>alert(1)</script><image href='https://evil'/></svg>"), imageBytes[..^1], imageBytes.Concat(Encoding.UTF8.GetBytes("<script/>" )).ToArray() })
                {
                    using var bad = await Put(client, $"/api/v1/documents/{doc}/assets/{Guid.NewGuid()}?commandId={Guid.NewGuid()}", bytes);
                    Assert.Equal(400, (int)bad.StatusCode); Assert.Equal("INVALID_ASSET", (await bad.Content.ReadFromJsonAsync<ApiError>())!.Code);
                }
                using var tooLarge = await Put(client, path + "?commandId=" + Guid.NewGuid(), new byte[DocumentAssetValidator.MaxAssetBytes + 1]);
                Assert.Equal(413, (int)tooLarge.StatusCode);
                using var wrongType = await Put(client, path + "?commandId=" + Guid.NewGuid(), imageBytes, "image/svg+xml"); Assert.Equal(415, (int)wrongType.StatusCode);
                Assert.Equal(415, (int)(await Put(client, path + "?commandId=" + Guid.NewGuid(), imageBytes, "image/jpeg")).StatusCode);
                Assert.Equal(413, (int)(await Put(client, path + "?commandId=" + Guid.NewGuid(), new byte[DocumentAssetValidator.MaxAssetBytes + 1])).StatusCode);
                var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
                Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/assets/{assetId}"]!["put"]!["requestBody"]!["content"]!["image/png"]);
                Assert.Equal("binary", openapi["paths"]!["/api/v1/documents/{documentId}/assets/{assetId}"]!["get"]!["responses"]!["200"]!["content"]!["image/png"]!["schema"]!["format"]!.GetValue<string>());
                Assert.Equal(200, (int)(await client.GetAsync("/api/v1/schemas/DocumentAsset.json")).StatusCode);
            }
            await using var reopened = new ServerProcess(config); await reopened.WaitUntilReadyAsync(); using var recovered = reopened.CreateClient();
            recovered.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(imageBytes, await recovered.GetByteArrayAsync($"/api/v1/documents/{doc}/assets/{asset}?versionId={version}"));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    private static async Task<HttpResponseMessage> Put(HttpClient client, string path, byte[] bytes, string type = "image/png")
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(type); request.Headers.ExpectContinue = bytes.Length > 1024 * 1024;
        // Oversized bodies are rejected before reading; do not reuse that connection while it is being closed.
        request.Headers.ConnectionClose = bytes.Length > DocumentAssetValidator.MaxAssetBytes;
        return await client.SendAsync(request);
    }
}
