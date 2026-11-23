using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentApiTests
{
    [Fact]
    public async Task AuthenticatedReadsAndWritesHaveSeparateBoundedBudgets()
    {
        using var key = RSA.Create(2048);
        var configuration = Production(key);
        configuration["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-rate-limit-tests", Guid.NewGuid().ToString("N"));
        await using var server = new ServerProcess(configuration);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        Authorize(client, key, "editor");

        for (var index = 0; index < 300; index++)
        {
            using var response = await client.GetAsync("/api/identity");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        await Error(await client.GetAsync("/api/identity"), 429, "RATE_LIMITED");

        for (var index = 0; index < 120; index++)
            await Error(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = Guid.Empty }), 400, "INVALID_ID");
        await Error(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = Guid.Empty }), 429, "RATE_LIMITED");

        Authorize(client, key, "another-editor");
        using var otherActor = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.OK, otherActor.StatusCode);
    }

    [Fact]
    public async Task AuthenticatedOwnersManageMembershipWithIsolationAndDurability()
    {
        using var key = RSA.Create(2048);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-api-tests", Guid.NewGuid().ToString("N"));
        var configuration = Production(key);
        configuration["Storage__Directory"] = directory;
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await using (var server = new ServerProcess(configuration))
        {
            await server.WaitUntilReadyAsync();
            using var client = server.CreateClient();
            await Error(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = first }), 401, "UNAUTHENTICATED");
            await Error(await client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "attacker", role = "Owner" }), 401, "UNAUTHENTICATED");
            await Error(await client.DeleteAsync($"/api/v1/documents/{first}/members/owner"), 401, "UNAUTHENTICATED");
            Authorize(client, key, "owner");
            client.DefaultRequestHeaders.Add("X-Actor-Id", "attacker");
            using var created = await client.PostAsJsonAsync("/api/v1/documents?actorId=attacker", new { documentId = first });
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var payload = await created.Content.ReadFromJsonAsync<DocumentAccessResponse>();
            Assert.Equal(new DocumentAccessResponse("ACCEPTED", first), payload);
            await Error(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = first }), 409, "DOCUMENT_EXISTS");
            await Success(client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "editor", role = "Editor" }));
            await Success(client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "viewer", role = "Viewer" }));
            await Error(await client.DeleteAsync($"/api/v1/documents/{first}/members/owner"), 409, "LAST_OWNER");
            foreach (var actor in new[] { "editor", "viewer", "attacker" })
            {
                Authorize(client, key, actor);
                await Error(await client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = actor, role = "Owner" }), 403, "FORBIDDEN");
                await Error(await client.DeleteAsync($"/api/v1/documents/{first}/members/owner"), 403, "FORBIDDEN");
            }
            Authorize(client, key, "other-owner");
            await Success(client.PostAsJsonAsync("/api/v1/documents", new { documentId = second }), 201);
            await Error(await client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "other-owner", role = "Owner" }), 403, "FORBIDDEN");
            Authorize(client, key, "owner");
            await Error(await client.DeleteAsync($"/api/v1/documents/{second}/members/other-owner"), 403, "FORBIDDEN");
            await Success(client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "successor", role = "Owner" }));
        }
        await using (var restarted = new ServerProcess(configuration))
        {
            await restarted.WaitUntilReadyAsync();
            using var client = restarted.CreateClient();
            Authorize(client, key, "successor");
            await Success(client.DeleteAsync($"/api/v1/documents/{first}/members/owner"));
            Authorize(client, key, "owner");
            await Error(await client.PutAsJsonAsync($"/api/v1/documents/{first}/members", new { memberId = "owner", role = "Owner" }), 403, "FORBIDDEN");
        }
        var storage = new SqliteDocumentJournal(directory, new VisualNodeProfile());
        Assert.True(await storage.CanEditAsync(new("editor"), first, default));
        Assert.True(await storage.CanReadAsync(new("viewer"), first, default));
        Assert.False(await storage.CanEditAsync(new("viewer"), first, default));
        Assert.False(await storage.CanReadAsync(new("owner"), first, default));
        Assert.True(await storage.CanEditAsync(new("other-owner"), second, default));
        Assert.Equal(0, (await storage.ReadAsync(first))!.Revision);
    }

    [Fact]
    public async Task MalformedRequestsAreStructuredAndDoNotMutateStorage()
    {
        using var key = RSA.Create(2048);
        var configuration = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-malformed-tests", Guid.NewGuid().ToString("N"));
        configuration["Storage__Directory"] = directory;
        await using var server = new ServerProcess(configuration);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        Authorize(client, key, "owner");
        var id = Guid.NewGuid();
        await Success(client.PostAsJsonAsync("/api/v1/documents", new { documentId = id }), 201);
        foreach (var body in new[] { "{", "null", "{}", "{\"documentId\":\"invalid\"}",
            $"{{\"documentId\":\"{Guid.NewGuid()}\",\"actorId\":\"attacker\"}}" })
            await Error(await client.PostAsync("/api/v1/documents", Json(body)), 400);
        await Error(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = Guid.Empty }), 400, "INVALID_ID");
        foreach (var body in new[] { "{}", "{\"memberId\":null,\"role\":\"Owner\"}", "{\"memberId\":\"\",\"role\":\"Owner\"}",
            "{\"memberId\":\"  \",\"role\":\"Owner\"}", "{\"memberId\":\"a\",\"role\":0}", "{\"memberId\":\"a\",\"role\":\"Admin\"}",
            $"{{\"memberId\":\"{new string('a', 257)}\",\"role\":\"Owner\"}}" })
            await Error(await client.PutAsync($"/api/v1/documents/{id}/members", Json(body)), 400);
        await Error(await client.PutAsJsonAsync("/api/v1/documents/not-a-guid/members", new { memberId = "a", role = "Owner" }), 400);
        await Error(await client.PostAsync("/api/v1/documents", new StringContent("{}")), 415);
        await Error(await client.PostAsync("/api/v1/documents", Json(new string(' ', 17000) + "{}")), 413);
        await Error(await client.DeleteAsync($"/api/v1/documents/{id}/members/owner"), 409, "LAST_OWNER");
        var damaged = Guid.NewGuid();
        await File.WriteAllTextAsync(Path.Combine(directory, $"{damaged:N}.sqlite"), "invalid storage contents");
        await Error(await client.PutAsJsonAsync($"/api/v1/documents/{damaged}/members", new { memberId = "owner", role = "Owner" }), 500, "INTERNAL_ERROR");
        await Success(client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "editor", role = "Editor" }));
    }

    [Fact]
    public async Task OpenApiAndPublishedSchemasDescribeTheHttpContracts()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(Production(key));
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        Authorize(client, key, "owner");
        var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        foreach (var (path, verb, status) in new[] { ("/api/v1/documents", "post", "201"),
            ("/api/v1/documents/{documentId}/members", "put", "200"),
            ("/api/v1/documents/{documentId}/members/{memberId}", "delete", "200") })
        {
            var operation = api["paths"]![path]![verb]!;
            Assert.NotNull(operation["security"]![0]!["Bearer"]);
            Assert.NotNull(operation["responses"]![status]);
            foreach (var error in new[] { "400", "401", "403", "409", "413", "415", "429", "500" })
                Assert.Contains("ApiError", operation["responses"]![error]!.ToJsonString());
        }
        foreach (var type in new[] { typeof(CreateDocumentRequest), typeof(SetDocumentMemberRequest), typeof(DocumentAccessResponse), typeof(ApiError) })
        {
            var schema = JsonNode.Parse(await client.GetStringAsync($"/api/v1/schemas/{type.Name}.json"))!;
            var openApiSchema = api["components"]!["schemas"]![type.Name]!;
            Assert.Equal(openApiSchema["properties"]!.AsObject().Select(x => x.Key).Order(),
                schema["properties"]!.AsObject().Select(x => x.Key).Order());
            Assert.DoesNotContain("actorId", schema.ToJsonString());
        }
        var memberSchema = DocumentSchemas.Create(typeof(SetDocumentMemberRequest));
        Assert.Equal(256, memberSchema["properties"]!["memberId"]!["maxLength"]!.GetValue<int>());
        Assert.Equal("^(Owner|Editor|Viewer)$", memberSchema["properties"]!["role"]!["pattern"]!.GetValue<string>());

        var createSchema = await Schema(client, nameof(CreateDocumentRequest));
        var memberContract = await Schema(client, nameof(SetDocumentMemberRequest));
        var responseSchema = await Schema(client, nameof(DocumentAccessResponse));
        var errorSchema = await Schema(client, nameof(ApiError));
        var id = Guid.NewGuid();
        var create = JsonNode.Parse($"{{\"documentId\":\"{id}\"}}")!;
        Assert.True(createSchema.EvaluateNode(create).IsValid);
        Assert.False(createSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
        create["actorId"] = "spoofed";
        Assert.False(createSchema.EvaluateNode(create).IsValid);
        foreach (var role in new[] { "Owner", "Editor", "Viewer" })
            Assert.True(memberContract.EvaluateNode(JsonNode.Parse($"{{\"memberId\":\"member\",\"role\":\"{role}\"}}")!).IsValid);
        foreach (var invalid in new[] { "{}", "{\"memberId\":\"m\",\"role\":\"Admin\"}", "{\"memberId\":\"m\",\"role\":0}",
            $"{{\"memberId\":\"{new string('a', 257)}\",\"role\":\"Owner\"}}" })
            Assert.False(memberContract.EvaluateNode(JsonNode.Parse(invalid)!).IsValid);
        using var created = await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.True(responseSchema.EvaluateNode(JsonNode.Parse(await created.Content.ReadAsStringAsync())!).IsValid);
        using var duplicate = await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.True(errorSchema.EvaluateNode(JsonNode.Parse(await duplicate.Content.ReadAsStringAsync())!).IsValid);
    }

    private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");
    private static async Task<JsonSchema> Schema(HttpClient client, string name)
    {
        using var json = System.Text.Json.JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{name}.json"));
        return JsonSchema.Build(json.RootElement.Clone());
    }
    private static void Authorize(HttpClient client, RSA key, string actor)
        => client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));

    private static async Task Success(Task<HttpResponseMessage> request, int status = 200)
    {
        using var response = await request;
        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal("ACCEPTED", (await response.Content.ReadFromJsonAsync<DocumentAccessResponse>())!.Code);
    }

    private static async Task Error(HttpResponseMessage response, int status, string? code = null)
    {
        using (response)
        {
            Assert.Equal(status, (int)response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();
            var error = System.Text.Json.JsonSerializer.Deserialize<ApiError>(body, System.Text.Json.JsonSerializerOptions.Web)!;
            Assert.Equal(status, error.Status);
            if (code is not null) Assert.Equal(code, error.Code);
            Assert.StartsWith("urn:figvam:error:", error.Type);
            Assert.DoesNotContain("sqlite", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Exception", body, StringComparison.OrdinalIgnoreCase);
        }
    }
}

internal static class SchemaTestExtensions
{
    public static EvaluationResults EvaluateNode(this JsonSchema schema, JsonNode instance)
        => schema.Evaluate(System.Text.Json.JsonSerializer.SerializeToElement(instance));
}

