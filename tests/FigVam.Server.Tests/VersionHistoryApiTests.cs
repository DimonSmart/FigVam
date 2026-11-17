using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class VersionHistoryApiTests
{
    [Fact]
    public async Task HistoryIsPagedAuthorizedAndDescribedByContracts()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(Production(key));
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        void Actor(string id) => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: id));
        Actor("owner");
        var doc = Guid.NewGuid();
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        var root = $"/api/v1/documents/{doc}";
        foreach (var name in new[] { "one", "two", "three" })
            Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/save", new { commandId = Guid.NewGuid(), name })).StatusCode);
        Actor("viewer");
        var first = (await client.GetFromJsonAsync<VersionHistoryResponse>(root + "/versions?limit=2"))!;
        Assert.Equal(new[] { "three", "two" }, first.Versions.Select(v => v.Name));
        Assert.All(first.Versions, v => Assert.Equal("owner", v.AuthorId));
        Assert.Equal(first.Versions[1].Revision, first.NextBeforeRevision);
        var second = (await client.GetFromJsonAsync<VersionHistoryResponse>(root + $"/versions?limit=2&beforeRevision={first.NextBeforeRevision}"))!;
        Assert.Equal("one", Assert.Single(second.Versions).Name);
        Assert.Null(second.NextBeforeRevision);
        Assert.Empty((await client.GetFromJsonAsync<VersionHistoryResponse>(root + "/versions?beforeRevision=1"))!.Versions);
        Assert.Equal(200, (int)(await client.GetAsync(root + "/versions?limit=100")).StatusCode);
        foreach (var query in new[] { "limit=0", "limit=101", "limit=x", "beforeRevision=0", "beforeRevision=-1", "beforeRevision=x", "limit=1&limit=2", "actorId=owner" })
        {
            using var response = await client.GetAsync(root + "/versions?" + query);
            Assert.Equal(400, (int)response.StatusCode);
            Assert.NotNull((await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        Actor("stranger");
        using var denied = await client.GetAsync(root + "/versions");
        Assert.Equal(403, (int)denied.StatusCode);
        Assert.Equal("FORBIDDEN", (await denied.Content.ReadFromJsonAsync<ApiError>())!.Code);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(401, (int)(await client.GetAsync(root + "/versions")).StatusCode);

        Actor("viewer");
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        var operation = api["paths"]!["/api/v1/documents/{documentId}/versions"]!["get"]!;
        Assert.NotNull(operation["security"]![0]!["Bearer"]);
        foreach (var status in new[] { "200", "400", "401", "403", "429", "500" }) Assert.NotNull(operation["responses"]![status]);
        foreach (var type in new[] { typeof(VersionHistoryResponse), typeof(VersionMetadataResponse) })
        {
            var schema = JsonNode.Parse(await client.GetStringAsync($"/api/v1/schemas/{type.Name}.json"))!;
            Assert.Equal(api["components"]!["schemas"]![type.Name]!["properties"]!.AsObject().Select(x => x.Key).Order(), schema["properties"]!.AsObject().Select(x => x.Key).Order());
        }
        using var document = System.Text.Json.JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/VersionHistoryResponse.json"));
        var contract = JsonSchema.Build(document.RootElement.Clone());
        var payload = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(first, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)))!;
        Assert.True(contract.EvaluateNode(payload).IsValid);
    }
}

