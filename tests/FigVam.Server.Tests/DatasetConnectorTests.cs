using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Connectors;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Connectors;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DatasetConnectorTests
{
    private sealed class Catalog : IRemoteJsonConnectorCatalog
    {
        public bool IsAllowed(string connectorId) => connectorId is "customers" or "other";
    }

    [Fact]
    public async Task AssignmentRemovalReplayHistoryAndSavedVersionsPreserveOfflineFixture()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-dataset-connectors-" + Guid.NewGuid());
        try
        {
            var doc = Guid.NewGuid(); var dataset = Guid.NewGuid(); var actor = new DocumentActor("owner");
            SqliteDocumentJournal Journal() => new(directory, new UnverifiedNodeProfile());
            DocumentCommandHandler Handler() { var j = Journal(); return new(j, j, new UnverifiedNodeProfile(), new Catalog()); }
            await Journal().CreateAsync(new(doc), actor);
            Assert.True((await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), dataset, "offline", "[1]"), actor)).Accepted);
            var set = new SetDatasetConnectorCommand(doc, Guid.NewGuid(), dataset, 1, "customers");
            var result = await Handler().HandleAsync(set, actor);
            Assert.True(result.Accepted); Assert.Equal(2, result.Revision); Assert.Equal(new[] { dataset }, result.AffectedIds);
            Assert.Equal(result, await Handler().HandleAsync(set with { ExpectedRevision = 0, ConnectorId = "unknown" }, actor));
            var payload = Assert.IsType<DatasetConnectorSet>(Assert.Single((await Journal().ReadEventsAsync(doc, 1)).Events!).Payload);
            Assert.Equal(dataset, payload.DatasetId); Assert.Equal("customers", payload.ConnectorId);
            Assert.Equal("customers", (await Journal().ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            var save = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid()), actor); // 3
            Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 3, "[2]"), actor)).Accepted);
            Assert.Equal("customers", (await Journal().ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            Assert.True((await Handler().HandleAsync(new RemoveDatasetConnectorCommand(doc, Guid.NewGuid(), dataset, 4), actor)).Accepted);
            var removed = Assert.IsType<DatasetConnectorSet>(Assert.Single((await Journal().ReadEventsAsync(doc, 4)).Events!).Payload);
            Assert.Null(removed.ConnectorId);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
            Assert.Equal("customers", (await Journal().ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
            Assert.Null((await Journal().ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            Assert.Equal("[2]", (await Journal().ReadAsync(doc))!.Document.Datasets.Single().FixtureJson);
            Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), save.VersionId!.Value), actor)).Accepted);
            Assert.Equal(new DocumentDataset(dataset, "offline", "[1]", "customers"), (await Journal().ReadAsync(doc))!.Document.Datasets.Single());
            var queries = new DocumentDatasetQueries(Journal(), Journal());
            Assert.Null((await queries.ReadAsync(doc, dataset, 1, actor)).Response!.Dataset.ConnectorId);
            Assert.Equal("customers", (await queries.ReadAsync(doc, dataset, 2, actor)).Response!.Dataset.ConnectorId);
            var diff = await new DocumentRevisionDiff(Journal(), Journal()).CompareAsync(doc, 1, 2, 0, 100, actor);
            Assert.Equal(new[] { "connectorId" }, Assert.Single(diff.Response!.Items).ChangedProperties);
            for (var i = 0; i < 25; i++) Assert.True((await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), Guid.NewGuid(), "extra", "null"), actor)).Accepted);
            Assert.Equal("customers", (await Journal().ReadAsync(doc))!.Document.Datasets.Single(d => d.Id == dataset).ConnectorId);
            Assert.Contains((await Journal().ReadHistoryAsync(doc, actor.Id)).Entries!, e => e.Type == "SET_DATASET_CONNECTOR");
            Assert.Contains((await Journal().ReadHistoryAsync(doc, actor.Id)).Entries!, e => e.Type == "REMOVE_DATASET_CONNECTOR");
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task RejectionsKeepRevisionAndDocumentAndForeignChangesBlockUndo()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-dataset-connectors-" + Guid.NewGuid());
        try
        {
            var doc = Guid.NewGuid(); var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile(), new Catalog());
            await journal.CreateAsync(new(doc), owner);
            await journal.SetMemberAsync(doc, "viewer", DocumentRole.Viewer, owner);
            await journal.SetMemberAsync(doc, "editor", DocumentRole.Editor, owner);
            await handler.HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), id, "offline", "[]"), owner);
            var before = JsonSerializer.Serialize(await journal.ReadAsync(doc));
            foreach (var connector in new[] { "unknown", "https://example.com", "token=secret", "", " ", "bad\nname", new string('a', 129) })
                Assert.Equal("CONNECTOR_NOT_ALLOWED", (await handler.HandleAsync(new SetDatasetConnectorCommand(doc, Guid.NewGuid(), id, 1, connector), owner)).Code);
            var command = new SetDatasetConnectorCommand(doc, Guid.NewGuid(), id, 1, "customers");
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(command, new("viewer"))).Code);
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(new RemoveDatasetConnectorCommand(doc, Guid.NewGuid(), id, 1), new("viewer"))).Code);
            Assert.Equal("REVISION_CONFLICT", (await handler.HandleAsync(command with { CommandId = Guid.NewGuid(), ExpectedRevision = 0 }, owner)).Code);
            Assert.Equal("INVALID_REVISION", (await handler.HandleAsync(command with { CommandId = Guid.NewGuid(), ExpectedRevision = -1 }, owner)).Code);
            Assert.Equal("INVALID_ID", (await handler.HandleAsync(command with { DatasetId = Guid.Empty }, owner)).Code);
            Assert.Equal("DATASET_NOT_FOUND", (await handler.HandleAsync(command with { CommandId = Guid.NewGuid(), DatasetId = Guid.NewGuid() }, owner)).Code);
            Assert.Equal("DATASET_CONNECTOR_NOT_FOUND", (await handler.HandleAsync(new RemoveDatasetConnectorCommand(doc, Guid.NewGuid(), id, 1), owner)).Code);
            Assert.Equal(before, JsonSerializer.Serialize(await journal.ReadAsync(doc)));
            Assert.Single((await journal.ReadHistoryAsync(doc, owner.Id)).Entries!);
            Assert.True((await handler.HandleAsync(command, owner)).Accepted);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Null((await journal.ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            Assert.True((await handler.HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal("customers", (await journal.ReadAsync(doc))!.Document.Datasets.Single().ConnectorId);
            Assert.True((await handler.HandleAsync(new SetDatasetConnectorCommand(doc, Guid.NewGuid(), id, 4, "other"), new("editor"))).Accepted);
            var current = JsonSerializer.Serialize(await journal.ReadAsync(doc));
            Assert.Equal("UNDO_NOT_APPLICABLE", (await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
            Assert.Equal(current, JsonSerializer.Serialize(await journal.ReadAsync(doc)));
        }
        finally { Directory.Delete(directory, true); }
    }

    private sealed class NoSecrets : IRemoteJsonSecrets
    {
        public string? GetBearerToken(string secretId) => throw new InvalidOperationException("No secret access expected.");
    }

    [Fact]
    public void CatalogChecksOnlyValidatedConfigurationWithoutResolvingOrAccessingSecrets()
    {
        using var reader = new RemoteJsonReader(new() { Connectors = new() { ["customers"] = new() { Url = "https://does-not-exist.invalid/data", AllowedAuthorities = [new() { Host = "does-not-exist.invalid" }], SecretId = "private" } } }, new NoSecrets(), false);
        Assert.True(reader.IsAllowed("customers")); Assert.False(reader.IsAllowed("CUSTOMERS")); Assert.False(reader.IsAllowed("unknown"));
        Assert.False(DatasetValidator.IsValid([new(Guid.NewGuid(), "name", "[]", "https://example.com")]));
    }

    [Fact]
    public async Task HttpUsesConfiguredIdsRejectsExtraFieldsAndPublishesContracts()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        config["RemoteJson__Connectors__customers__Url"] = "https://does-not-exist.invalid/data";
        config["RemoteJson__Connectors__customers__AllowedAuthorities__0__Host"] = "does-not-exist.invalid";
        config["RemoteJson__Connectors__customers__SecretId"] = "server-secret-marker";
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); var doc = Guid.NewGuid(); var id = Guid.NewGuid();
        var commands = $"/api/v1/documents/{doc}/commands/";
        var set = new SetDatasetConnectorRequest { CommandId = Guid.NewGuid(), DatasetId = id, ExpectedRevision = 1, ConnectorId = "customers" };
        Assert.Equal(401, (int)(await client.PostAsJsonAsync(commands + "set-dataset-connector", set)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(commands + "add-dataset", new { commandId = Guid.NewGuid(), datasetId = id, name = "local", fixtureJson = "[1]" })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(commands + "set-dataset-connector", set)).StatusCode);
        var metadata = await client.GetStringAsync($"/api/v1/documents/{doc}/datasets/{id}");
        Assert.Equal("customers", (string)JsonNode.Parse(metadata)!["dataset"]!["connectorId"]!);
        Assert.DoesNotContain("does-not-exist", metadata); Assert.DoesNotContain("server-secret-marker", metadata);
        var invalid = await client.PostAsJsonAsync(commands + "set-dataset-connector", new { commandId = Guid.NewGuid(), datasetId = id, expectedRevision = 2, connectorId = "unknown" });
        Assert.Equal(400, (int)invalid.StatusCode); Assert.Contains("CONNECTOR_NOT_ALLOWED", await invalid.Content.ReadAsStringAsync());
        Assert.Equal(400, (int)(await client.PostAsJsonAsync(commands + "set-dataset-connector", new { commandId = Guid.NewGuid(), datasetId = id, expectedRevision = 2, connectorId = "customers", url = "https://example.com", secret = "private-marker" })).StatusCode);
        Assert.Equal(400, (int)(await client.PostAsJsonAsync(commands + "set-dataset-connector", new { commandId = Guid.NewGuid(), datasetId = id, expectedRevision = 2, connectorId = "https://example.com" })).StatusCode);
        Assert.Equal(2, (long)JsonNode.Parse(await client.GetStringAsync($"/api/v1/documents/{doc}/datasets/{id}"))!["revision"]!);
        var remove = new RemoveDatasetConnectorRequest { CommandId = Guid.NewGuid(), DatasetId = id, ExpectedRevision = 2 };
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(commands + "remove-dataset-connector", remove)).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(commands + "set-dataset-connector", set)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(commands + "remove-dataset-connector", remove)).StatusCode);
        var fixture = JsonNode.Parse(await client.GetStringAsync($"/api/v1/documents/{doc}/datasets/{id}/fixture"))!;
        Assert.Equal("[1]", (string)fixture["fixtureJson"]!);
        foreach (var (payload, name) in new (object, string)[] { (set, "SetDatasetConnectorRequest"), (remove, "RemoveDatasetConnectorRequest") })
        {
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{name}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(JsonSerializer.SerializeToNode(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        }
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/set-dataset-connector"]!["post"]);
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/remove-dataset-connector"]!["post"]);
    }
}
