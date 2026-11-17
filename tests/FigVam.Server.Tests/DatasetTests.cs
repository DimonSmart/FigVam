using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DatasetTests
{
    [Theory]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("123")]
    [InlineData("[]")]
    [InlineData("[{\"name\":\"one\"}]")]
    [InlineData("{\"rows\":[1,2,3],\"empty\":[]}")]
    [InlineData("{\"text\":\"<script>alert(1)</script>\"}")]
    public void AcceptsJsonValuesAsInertData(string json) => Assert.True(DatasetValidator.IsValidFixture(json));

    [Theory]
    [InlineData("")]
    [InlineData("{")]
    [InlineData("{} {}")]
    [InlineData("[1,]")]
    [InlineData("/*comment*/ []")]
    [InlineData("{\"a\":1,\"a\":2}")]
    [InlineData("{\"a\":1,\"\\u0061\":2}")]
    [InlineData("{\"a\":[{\"b\":1,\"b\":2}]}")]
    public void RejectsInvalidOrAmbiguousJson(string json) => Assert.False(DatasetValidator.IsValidFixture(json));

    [Fact]
    public void EnforcesUtf8BytesAndJsonDepthAtExactBoundaries()
    {
        Assert.True(DatasetValidator.IsValidFixture("\"" + new string('x', DatasetValidator.MaxFixtureBytes - 2) + "\""));
        Assert.False(DatasetValidator.IsValidFixture("\"" + new string('x', DatasetValidator.MaxFixtureBytes - 1) + "\""));
        Assert.False(DatasetValidator.IsValidFixture("\"" + new string('я', DatasetValidator.MaxFixtureBytes / 2) + "\""));
        Assert.True(DatasetValidator.IsValidFixture(new string('[', DatasetValidator.MaxFixtureDepth) + "0" + new string(']', DatasetValidator.MaxFixtureDepth)));
        Assert.False(DatasetValidator.IsValidFixture(new string('[', DatasetValidator.MaxFixtureDepth + 1) + "0" + new string(']', DatasetValidator.MaxFixtureDepth + 1)));
    }

    [Fact]
    public void EnforcesDatasetCountAndAggregateFixtureLimits()
    {
        var small = Enumerable.Range(0, DatasetValidator.MaxDatasets).Select(_ => new DocumentDataset(Guid.NewGuid(), "same", "null")).ToArray();
        Assert.True(DatasetValidator.IsValid(small));
        Assert.False(DatasetValidator.IsValid([.. small, new(Guid.NewGuid(), "same", "null")]));
        var fixture = "\"" + new string('x', DatasetValidator.MaxFixtureBytes - 2) + "\"";
        var full = Enumerable.Range(0, DatasetValidator.MaxDocumentFixtureBytes / DatasetValidator.MaxFixtureBytes)
            .Select(_ => new DocumentDataset(Guid.NewGuid(), "same", fixture)).ToArray();
        Assert.True(DatasetValidator.IsValid(full));
        Assert.False(DatasetValidator.IsValid([.. full, new(Guid.NewGuid(), "same", "0")]));
    }

    [Fact]
    public async Task CommandsReplayPreserveIdentityAndGuardHistoryAcrossEditorsAndSavedVersions()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-datasets-" + Guid.NewGuid());
        try
        {
            var doc = Guid.NewGuid(); var datasetId = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            SqliteDocumentJournal Journal() => new(directory, new UnverifiedNodeProfile());
            DocumentCommandHandler Handler() { var j = Journal(); return new(j, j, new UnverifiedNodeProfile()); }
            await Journal().CreateAsync(new(doc), owner);
            await Journal().SetMemberAsync(doc, editor.Id, DocumentRole.Editor, owner);
            var add = new AddDatasetCommand(doc, Guid.NewGuid(), datasetId, "customers", "[{\"name\":\"one\"}]");
            var accepted = await Handler().HandleAsync(add, owner);
            Assert.True(accepted.Accepted); Assert.Equal(new[] { datasetId }, accepted.AffectedIds);
            Assert.Equal(accepted, await Handler().HandleAsync(add with { Name = "", FixtureJson = "invalid" }, owner));
            var initialEvent = Assert.IsType<DatasetAdded>(Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!).Payload);
            Assert.Equal(add.FixtureJson, initialEvent.Dataset.FixtureJson);
            var replace = new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), datasetId, 1, "[]");
            var replaced = await Handler().HandleAsync(replace, owner);
            Assert.True(replaced.Accepted);
            Assert.Equal(replaced, await Handler().HandleAsync(replace with { ExpectedRevision = 0, FixtureJson = "invalid" }, owner));
            var fixtureEvent = Assert.IsType<DatasetFixtureReplaced>((await Journal().ReadEventsAsync(doc, 1)).Events!.Single().Payload);
            Assert.Equal(datasetId, fixtureEvent.DatasetId); Assert.Equal("[]", fixtureEvent.FixtureJson);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal(add.FixtureJson, (await Journal().ReadAsync(doc))!.Document.Datasets.Single().FixtureJson);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal("[]", (await Journal().ReadAsync(doc))!.Document.Datasets.Single().FixtureJson);
            var save = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid(), "dataset"), owner);
            Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), datasetId, 5, "[1,2,3]"), editor)).Accepted);
            Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
            var queries = new DocumentDatasetQueries(Journal(), Journal());
            Assert.Equal(add.FixtureJson, (await queries.ReadFixtureAsync(doc, datasetId, 1, owner)).Response!.FixtureJson);
            Assert.Equal("[]", (await queries.ReadFixtureAsync(doc, datasetId, save.Revision, owner)).Response!.FixtureJson);
            for (var i = 0; i < 28; i++) Assert.True((await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), Guid.NewGuid(), "same name", "null"), editor)).Accepted);
            var recovered = (await Journal().ReadAsync(doc))!;
            Assert.Equal(34, recovered.Revision); Assert.Equal(29, recovered.Document.Datasets.Count);
            var firstPage = (await queries.ListAsync(doc, null, 0, 10, owner)).Response!;
            var secondPage = (await queries.ListAsync(doc, null, 10, 100, owner)).Response!;
            Assert.Equal(29, firstPage.Total); Assert.Equal(10, firstPage.Items.Count); Assert.Equal(19, secondPage.Items.Count);
            Assert.Equal(recovered.Document.Datasets.OrderBy(d => d.Id).Select(d => d.Id), firstPage.Items.Concat(secondPage.Items).Select(d => d.Id));
            Assert.Single((await queries.ListAsync(doc, 1, 0, 100, owner)).Response!.Items);
            var diff = (await new DocumentRevisionDiff(Journal(), Journal()).CompareAsync(doc, 1, 2, 0, 100, owner)).Response!;
            var change = Assert.Single(diff.Items); Assert.Equal(datasetId, change.Id); Assert.Equal("dataset", change.Type); Assert.Equal(new[] { "fixtureJson" }, change.ChangedProperties);
            var restored = await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), save.VersionId!.Value), owner);
            Assert.True(restored.Accepted); Assert.Contains(datasetId, restored.AffectedIds!);
            var dataset = Assert.Single((await Journal().ReadAsync(doc))!.Document.Datasets);
            Assert.Equal(datasetId, dataset.Id); Assert.Equal("customers", dataset.Name); Assert.Equal("[]", dataset.FixtureJson);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal("[1,2,3]", (await Journal().ReadAsync(doc))!.Document.Datasets.Single(d => d.Id == datasetId).FixtureJson);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task InvalidUnauthorizedAndStaleCommandsDoNotChangeDocumentOrRevision()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-datasets-" + Guid.NewGuid());
        try
        {
            var doc = Guid.NewGuid(); var dataset = Guid.NewGuid(); var owner = new DocumentActor("owner");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(doc), owner); await journal.SetMemberAsync(doc, "viewer", DocumentRole.Viewer, owner);
            var add = new AddDatasetCommand(doc, Guid.NewGuid(), dataset, "data", "[]");
            Assert.True((await handler.HandleAsync(add, owner)).Accepted);
            var before = JsonSerializer.Serialize(await journal.ReadAsync(doc));
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(add, new("viewer"))).Code);
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 1, "null"), new("viewer"))).Code);
            foreach (var json in new[] { "{", "[1,]", new string('[', 33) + "0" + new string(']', 33), "\"" + new string('x', DatasetValidator.MaxFixtureBytes) + "\"" })
                Assert.Equal("INVALID_DATASET_FIXTURE", (await handler.HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 1, json), owner)).Code);
            Assert.Equal("REVISION_CONFLICT", (await handler.HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 0, "null"), owner)).Code);
            Assert.Equal("INVALID_REVISION", (await handler.HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, -1, "null"), owner)).Code);
            Assert.Equal("DATASET_NOT_FOUND", (await handler.HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), Guid.NewGuid(), 1, "null"), owner)).Code);
            Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(add with { CommandId = Guid.NewGuid() }, owner)).Code);
            Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), dataset), owner)).Code);
            Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(add with { CommandId = Guid.NewGuid(), DatasetId = doc }, owner)).Code);
            foreach (var name in new[] { "", " ", "bad\nname", new string('x', 257) })
                Assert.Equal("INVALID_DATASET", (await handler.HandleAsync(add with { CommandId = Guid.NewGuid(), DatasetId = Guid.NewGuid(), Name = name }, owner)).Code);
            Assert.Equal(before, JsonSerializer.Serialize(await journal.ReadAsync(doc)));
            Assert.Single((await journal.ReadHistoryAsync(doc, owner.Id)).Entries!);
            var queries = new DocumentDatasetQueries(journal, journal);
            Assert.Equal("FORBIDDEN", (await queries.ReadFixtureAsync(doc, dataset, null, new("stranger"))).Code);
            Assert.Equal("INVALID_QUERY", (await queries.ListAsync(doc, null, 0, 101, owner)).Code);
            Assert.Equal("INVALID_QUERY", (await queries.ListAsync(doc, null, -1, 1, owner)).Code);
            Assert.Equal("INVALID_REVISION", (await queries.ReadAsync(doc, dataset, -1, owner)).Code);
            Assert.Equal("INVALID_REVISION", (await queries.ReadAsync(doc, dataset, 99, owner)).Code);
            Assert.Equal("DATASET_NOT_FOUND", (await queries.ReadAsync(doc, dataset, 0, owner)).Code);
            Assert.Equal("[]", (await queries.ReadFixtureAsync(doc, dataset, 1, new("viewer"))).Response!.FixtureJson);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task CreationUndoRedoAndReusedIdsAreSafe()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-datasets-" + Guid.NewGuid());
        try
        {
            var doc = Guid.NewGuid(); var dataset = Guid.NewGuid(); var owner = new DocumentActor("owner"); var editor = new DocumentActor("editor");
            var journal = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            await journal.CreateAsync(new(doc), owner); await journal.SetMemberAsync(doc, editor.Id, DocumentRole.Editor, owner);
            Assert.True((await handler.HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), dataset, "data", "[]"), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Empty((await journal.ReadAsync(doc))!.Document.Datasets);
            Assert.True((await handler.HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal(dataset, (await journal.ReadAsync(doc))!.Document.Datasets.Single().Id);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), dataset), editor)).Accepted);
            Assert.Equal("REDO_NOT_APPLICABLE", (await handler.HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
            Assert.Empty((await journal.ReadAsync(doc))!.Document.Datasets);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task HttpCommandsQueriesSchemasAndEventsShareAuthorizationAndRevisionContracts()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); var doc = Guid.NewGuid(); var dataset = Guid.NewGuid();
        var route = $"/api/v1/documents/{doc}/datasets"; var commands = $"/api/v1/documents/{doc}/commands/";
        Assert.Equal(401, (int)(await client.GetAsync(route)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var fixture = "{\"secretTestMarker\":\"" + new string('x', 20000) + "\"}";
        var request = new AddDatasetRequest { CommandId = Guid.NewGuid(), DatasetId = dataset, Name = "demo", FixtureJson = fixture };
        var added = await client.PostAsJsonAsync(commands + "add-dataset", request);
        Assert.Equal(200, (int)added.StatusCode);
        Assert.Contains(dataset.ToString(), await added.Content.ReadAsStringAsync());
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(commands + "add-dataset", request)).StatusCode);
        var replace = new ReplaceDatasetFixtureRequest { CommandId = Guid.NewGuid(), DatasetId = dataset, ExpectedRevision = 1, FixtureJson = "[1,2,3]" };
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(commands + "replace-dataset-fixture", replace)).StatusCode);
        var stale = await client.PostAsJsonAsync(commands + "replace-dataset-fixture", withNewCommand());
        Assert.Equal(409, (int)stale.StatusCode);
        ReplaceDatasetFixtureRequest withNewCommand() => new() { CommandId = Guid.NewGuid(), DatasetId = dataset, ExpectedRevision = 1, FixtureJson = "[]" };
        foreach (var (path, schemaName) in new[] { (route + "?limit=1", "DatasetListResponse"), (route + "/" + dataset + "?revision=1", "DatasetResponse"), (route + "/" + dataset + "/fixture?revision=1", "DatasetFixtureResponse") })
        {
            var payload = JsonNode.Parse(await client.GetStringAsync(path))!;
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(payload).IsValid);
        }
        foreach (var (payload, schemaName) in new (object, string)[] { (request, "AddDatasetRequest"), (replace, "ReplaceDatasetFixtureRequest") })
        {
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(JsonSerializer.SerializeToNode(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        }
        var metadata = await client.GetStringAsync(route);
        Assert.DoesNotContain("secretTestMarker", metadata); Assert.DoesNotContain("fixtureJson", metadata);
        Assert.Equal(fixture, (string)JsonNode.Parse(await client.GetStringAsync(route + "/" + dataset + "/fixture?revision=1"))!["fixtureJson"]!);
        Assert.Equal("[1,2,3]", (string)JsonNode.Parse(await client.GetStringAsync(route + "/" + dataset + "/fixture"))!["fixtureJson"]!);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?limit=101")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(route + "?revision=1&revision=2")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(route + "/" + dataset + "/fixture?live=true")).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(route + "/" + Guid.NewGuid())).StatusCode);
        var invalid = await client.PostAsJsonAsync(commands + "replace-dataset-fixture", new { commandId = Guid.NewGuid(), datasetId = dataset, expectedRevision = 2, fixtureJson = "{" });
        Assert.Equal(400, (int)invalid.StatusCode);
        Assert.Equal("INVALID_DATASET_FIXTURE", (string)JsonNode.Parse(await invalid.Content.ReadAsStringAsync())!["code"]!);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(200, (int)(await client.GetAsync(route + "/" + dataset + "/fixture")).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(commands + "add-dataset", request)).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(commands + "replace-dataset-fixture", replace)).StatusCode);
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/datasets/{datasetId}/fixture"]!["get"]!["responses"]!["200"]);
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/add-dataset"]!["post"]);
        Assert.Contains("INVALID_DATASET_FIXTURE", openapi["info"]!["description"]!.ToString());
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "stranger"));
        Assert.Equal(403, (int)(await client.GetAsync(route)).StatusCode);
        Assert.Equal(403, (int)(await client.GetAsync(route + "/" + dataset + "/fixture?revision=1")).StatusCode);
    }
    [Fact]
    public async Task CsvHttpCommandsExposeSchemasAndRejectWithoutEchoingContent()
    {
        using var key = RSA.Create(2048); await using var server = new ServerProcess(Production(key)); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); var doc = Guid.NewGuid(); var id = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var root = $"/api/v1/documents/{doc}/commands/";
        var add = new AddCsvDatasetRequest { CommandId = Guid.NewGuid(), DatasetId = id, Name = "csv", Csv = "name\nAlice" };
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "add-csv-dataset", add)).StatusCode);
        var invalid = new ReplaceDatasetFixtureFromCsvRequest { CommandId = Guid.NewGuid(), DatasetId = id, ExpectedRevision = 1, Csv = "name\n\"private-marker" };
        var response = await client.PostAsJsonAsync(root + "replace-dataset-fixture-from-csv", invalid);
        Assert.Equal(400, (int)response.StatusCode);
        var error = await response.Content.ReadAsStringAsync();
        Assert.Contains("INVALID_CSV_FIXTURE", error); Assert.DoesNotContain("private-marker", error);
        foreach (var (payload, schemaName) in new (object, string)[] { (add, "AddCsvDatasetRequest"), (invalid, "ReplaceDatasetFixtureFromCsvRequest") })
        {
            using var schema = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"));
            Assert.True(JsonSchema.Build(schema.RootElement.Clone()).EvaluateNode(JsonSerializer.SerializeToNode(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        }
        var openapi = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/add-csv-dataset"]!["post"]);
        Assert.NotNull(openapi["paths"]!["/api/v1/documents/{documentId}/commands/replace-dataset-fixture-from-csv"]!["post"]);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "replace-dataset-fixture-from-csv", invalid)).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "add-csv-dataset", add)).StatusCode);
        var fixture = JsonNode.Parse(await client.GetStringAsync($"/api/v1/documents/{doc}/datasets/{id}/fixture"))!;
        Assert.Equal("[{\"name\":\"Alice\"}]", (string)fixture["fixtureJson"]!);
    }

}
