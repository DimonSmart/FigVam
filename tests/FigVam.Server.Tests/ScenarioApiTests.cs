using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Preview;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ScenarioApiTests
{
    [Fact]
    public async Task ApiDocumentsContractsAndEnforcesProfileRightsAndHistoricalQueries()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-scenario-api-" + Guid.NewGuid());
        try
        {
            using var key = RSA.Create(2048); var config = ServerTestIdentity.Production(key); config["Storage__Directory"] = directory;
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
            var doc = Guid.NewGuid(); var root = $"/api/v1/documents/{doc}";
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
            var scenario = new PreviewScenario(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), PreviewEvent.Click, [new Navigate(Guid.NewGuid()), new ShowVariant(null), new SetDemoValue(Guid.NewGuid(), "x"), new SelectDataset(null), new OpenOverlay(Guid.NewGuid()), new CloseOverlay(), new ResetPreview()]);
            var create = new CreateScenarioRequest { CommandId = Guid.NewGuid(), Scenario = scenario };
            var update = new UpdateScenarioRequest { CommandId = Guid.NewGuid(), Scenario = scenario, ExpectedRevision = 0 };
            var delete = new DeleteScenarioRequest { CommandId = Guid.NewGuid(), ScenarioId = scenario.Id, ExpectedRevision = 0 };
            var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
            foreach (var (name, payload) in new[] { (nameof(CreateScenarioRequest), JsonSerializer.SerializeToNode(create, options)!), (nameof(UpdateScenarioRequest), JsonSerializer.SerializeToNode(update, options)!), (nameof(DeleteScenarioRequest), JsonSerializer.SerializeToNode(delete, options)!), (nameof(ScenariosResponse), JsonSerializer.SerializeToNode(new ScenariosResponse(doc, 0, [scenario], 0, 50, 1), options)!) })
            {
                using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{name}.json"));
                var contract = JsonSchema.Build(schema.RootElement.Clone());
                Assert.True(contract.EvaluateNode(payload).IsValid);
                if (name == nameof(CreateScenarioRequest))
                {
                    var missingEvent = payload.DeepClone(); missingEvent["scenario"]!.AsObject().Remove("event");
                    Assert.False(contract.EvaluateNode(missingEvent).IsValid);
                    Assert.Equal(400, (int)(await client.PostAsJsonAsync(root + "/commands/create-scenario", missingEvent)).StatusCode);
                }
            }
            var openapi = await client.GetStringAsync("/openapi/v1.json");
            Assert.Contains("create-scenario", openapi); Assert.Contains("update-scenario", openapi); Assert.Contains("delete-scenario", openapi);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(root + "/commands/create-scenario", create)).StatusCode);
            var staleCreate = new CreateScenarioRequest { CommandId = Guid.NewGuid(), Scenario = scenario, ExpectedRevision = 1 };
            Assert.Equal(409, (int)(await client.PostAsJsonAsync(root + "/commands/create-scenario", staleCreate)).StatusCode);
            Assert.Equal(404, (int)(await client.PostAsJsonAsync(root + "/commands/update-scenario", update)).StatusCode);
            Assert.Equal(404, (int)(await client.PostAsJsonAsync(root + "/commands/delete-scenario", delete)).StatusCode);
            Assert.Empty((await client.GetFromJsonAsync<ScenariosResponse>(root + "/scenarios?revision=0"))!.Items);
            Assert.Equal(400, (int)(await client.GetAsync(root + "/scenarios?limit=101")).StatusCode);
            Assert.Equal(400, (int)(await client.GetAsync(root + "/scenarios?revision=-1")).StatusCode);
            Assert.Equal(400, (int)(await client.GetAsync(root + "/scenarios?unknown=1")).StatusCode);
            Assert.Equal(200, (int)(await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
            Assert.Equal(200, (int)(await client.GetAsync(root + "/scenarios")).StatusCode);
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/create-scenario", create)).StatusCode);
            Assert.Equal(0, (await client.GetFromJsonAsync<ScenariosResponse>(root + "/scenarios"))!.Revision);
            client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
            Assert.Equal(403, (int)(await client.GetAsync(root + "/scenarios")).StatusCode);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
