using System.Collections.Immutable;
using System.Net.Http.Json;
using System.Security.Cryptography;
using static FigVam.Server.Tests.ServerTestIdentity;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class NodeDataBindingTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-data-binding-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), node = Guid.NewGuid(), dataset = Guid.NewGuid();
    private readonly DocumentActor actor = new("owner");
    private sealed class Profile : INodeProfile
    {
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch {
            "text" => new(NodePropertyType.String), "visible" => new(NodePropertyType.Boolean),
            "count" => new(NodePropertyType.Number, v => ((NodeNumberValue)v).Value >= 0 ? null : "Negative values are unsupported."), _ => null };
    }
    private sealed class Authorization(bool edit = true) : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(edit);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler(bool edit = true) => new(new Authorization(edit), Journal(), new Profile());
    private Task Seed() => Journal().InitializeAsync(new(doc, [], [new(Guid.NewGuid(), [node])], [new(node, "test", []) { Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("text", new NodeStringValue("literal")) }]) {
        Datasets = [new(dataset, "fixture", "{\"rows\":[{\"name\":\"Alice\"}],\"negative\":-1}")] });
    private BindNodeDataCommand Bind(string property = "text", DataBinding? binding = null) => new(doc, Guid.NewGuid(), node, property,
        new(dataset, binding ?? new([new DataProperty("rows"), new DataIndex(0), new DataProperty("name")], ExpectedType: DataExpectedType.String)));

    [Fact]
    public async Task BindingPersistsReplaysEvaluatesAndSupportsGuardedHistory()
    {
        await Seed();
        var bind = Bind();
        var result = await Handler().HandleAsync(bind, actor);
        Assert.True(result.Accepted);
        Assert.Equal(result, await Handler().HandleAsync(bind with { Binding = new(Guid.NewGuid(), new([])) }, actor));
        var recovered = (await Journal().ReadAsync(doc))!;
        Assert.Equal(new NodeStringValue("Alice"), NodeDataBindingEvaluator.Evaluate(recovered.Document, recovered.Document.Nodes.Single(), "text", recovered.Document.Nodes.Single().DataBindings["text"], new Profile()).Value);
        var committed = Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!);
        Assert.Equal("BIND_NODE_DATA", committed.Type);
        Assert.IsType<DataIndex>(Assert.IsType<NodeDataBindingSet>(committed.Payload).Binding!.Binding.Path[1]);
        Assert.True((await Handler().HandleAsync(new UnbindNodeDataCommand(doc, Guid.NewGuid(), node, "text"), actor)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Nodes.Single().DataBindings);
        Assert.Equal(new NodeStringValue("literal"), (await Journal().ReadAsync(doc))!.Document.Nodes.Single().Properties["text"]);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Single((await Journal().ReadAsync(doc))!.Document.Nodes.Single().DataBindings);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        var diff = (await new DocumentRevisionDiff(new Authorization(), Journal()).CompareAsync(doc, 0, 1, 0, 10, actor)).Response!;
        Assert.Equal("dataBindings.text", Assert.Single(Assert.Single(diff.Items).ChangedProperties));
        for (var i = 0; i < 32; i++) Assert.True((await Handler().HandleAsync(Bind(), actor)).Accepted);
        Assert.Single((await Journal().ReadAsync(doc))!.Document.Nodes.Single().DataBindings);
    }

    [Fact]
    public async Task InvalidBindingsAndUnauthorizedWritesHaveNoRevisionEffects()
    {
        await Seed();
        var cases = new[] {
            (Bind() with { NodeId = Guid.NewGuid() }, "NODE_NOT_FOUND"),
            (Bind() with { Binding = new(Guid.NewGuid(), new([])) }, "DATASET_NOT_FOUND"),
            (Bind("unsupported"), "UNSUPPORTED_PROPERTY"),
            (Bind("visible"), "INVALID_PROPERTY_TYPE"),
            (Bind(binding: new([new DataIndex(-1)], ExpectedType: DataExpectedType.String)), "INVALID_DATA_BINDING"),
            (Bind(binding: new([], (DataOperation)999, DataExpectedType.String)), "INVALID_DATA_BINDING"),
            (Bind(binding: new(Enumerable.Repeat<DataPathSegment>(new DataProperty("x"), 33).ToArray(), ExpectedType: DataExpectedType.String)), "INVALID_DATA_BINDING"),
            (Bind(binding: new([new DataProperty("absent")], ExpectedType: DataExpectedType.String)), "DATA_MISSING_VALUE"),
            (Bind(binding: new([new DataProperty("rows")], ExpectedType: DataExpectedType.String)), "DATA_INCOMPATIBLE_TYPE"),
            (Bind("count", new([new DataProperty("negative")], ExpectedType: DataExpectedType.Number)), "INVALID_PROPERTY_VALUE") };
        foreach (var (command, code) in cases) {
            var rejected = await Handler().HandleAsync(command, actor);
            Assert.Equal(code, rejected.Code); Assert.NotNull(rejected.Explanation);
            Assert.Equal(rejected, await Handler().HandleAsync(Bind() with { CommandId = command.CommandId }, actor));
        }
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(Bind(), actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Nodes.Single().DataBindings);
    }

    [Fact]
    public async Task FixtureChangesReportMissingDataAndOperationsRemainTyped()
    {
        await Seed();
        Assert.True((await Handler().HandleAsync(Bind(), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Bind("count", new([new DataProperty("rows")], DataOperation.Count)), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Bind("visible", new([new DataProperty("absent")], DataOperation.IsPresent)), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 3, "{}"), actor)).Accepted);
        var diagnostics = await new DocumentDiagnostics(new Authorization(), Journal(), new Profile()).ReadAsync(doc, null, null, 0, 100, actor);
        Assert.Equal(2, diagnostics.Response!.Total);
        Assert.All(diagnostics.Response.Items, d => { Assert.Equal("DATA_MISSING_VALUE", d.Code); Assert.Equal(dataset, d.ReferenceId); Assert.Contains(node.ToString(), d.Path); });
        Assert.Empty(DocumentStructureValidator.Validate((await Journal().ReadAsync(doc))!.Document, new Profile()));
    }

    [Fact]
    public async Task DatasetDeletionAndUndoNeverLeaveDanglingBindings()
    {
        await Seed();
        Assert.True((await Handler().HandleAsync(Bind(), actor)).Accepted);
        Assert.Equal("DATASET_IN_USE", (await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 1), actor)).Code);
        var other = new DocumentActor("other");
        Assert.True((await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), node), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 2), other)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
        Assert.Equal(3, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), other)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Single((await Journal().ReadAsync(doc))!.Document.Nodes.Single().DataBindings);
        Assert.Equal("DATASET_IN_USE", (await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 5), other)).Code);
    }

    [Fact]
    public async Task CurrentProductionProfileIsNotExpanded()
    {
        await Seed(); var profile = new UnverifiedNodeProfile();
        var handler = new DocumentCommandHandler(new Authorization(), Journal(), profile);
        Assert.Equal("UNSUPPORTED_PROPERTY", (await handler.HandleAsync(Bind(), actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
    }

    [Fact]
    public void PublishedSchemasRoundTripTypedPathsAndRejectUnknownSegments()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var request = new BindNodeDataRequest { CommandId = Guid.NewGuid(), NodeId = node, Property = "text", Binding = Bind().Binding };
        var json = JsonSerializer.Serialize(request, options);
        Assert.IsType<DataIndex>(JsonSerializer.Deserialize<BindNodeDataRequest>(json, options)!.Binding.Binding.Path[1]);
        var schema = DocumentSchemas.Create(typeof(BindNodeDataRequest));
        schema["$id"] = "urn:test:" + Guid.NewGuid();
        Assert.True(JsonSchema.FromText(schema!.ToJsonString()).Evaluate(JsonDocument.Parse(json).RootElement.Clone()).IsValid);
        Assert.Throws<JsonException>(() => { JsonSerializer.Deserialize<BindNodeDataRequest>(json.Replace("\"index\"", "\"script\""), options); });
    }
    [Fact]
    public async Task HttpCommandsPublishContractsAndEnforceAuthorization()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var storage = Path.Combine(Path.GetTempPath(), "figvam-binding-http-" + Guid.NewGuid());
        config["Storage__Directory"] = storage;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
            var requests = new (string Route, object Payload, string Schema)[] {
                ("bind-node-data", new BindNodeDataRequest { CommandId = Guid.NewGuid(), NodeId = node, Property = "text", Binding = Bind().Binding }, nameof(BindNodeDataRequest)),
                ("unbind-node-data", new UnbindNodeDataRequest { CommandId = Guid.NewGuid(), NodeId = node, Property = "text" }, nameof(UnbindNodeDataRequest)),
                ("delete-dataset", new DeleteDatasetRequest { CommandId = Guid.NewGuid(), DatasetId = dataset, ExpectedRevision = 0 }, nameof(DeleteDatasetRequest)) };
            var openapi = await client.GetStringAsync("/openapi/v1.json");
            foreach (var (route, payload, schemaName) in requests)
            {
                var schemaJson = JsonNode.Parse(await client.GetStringAsync($"/api/v1/schemas/{schemaName}.json"))!;
                schemaJson["$id"] = "urn:test:" + Guid.NewGuid();
                var schema = JsonSchema.FromText(schemaJson.ToJsonString());
                Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
                Assert.Contains("/commands/" + route, openapi);
                var response = await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/{route}", payload);
                Assert.Equal(404, (int)response.StatusCode);
                Assert.Contains((await response.Content.ReadFromJsonAsync<ApiError>())!.Code, new[] { "NODE_NOT_FOUND", "DATASET_NOT_FOUND" });
            }
            Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            foreach (var (route, payload, _) in requests)
                Assert.Equal(403, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/{route}", payload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(storage, new UnverifiedNodeProfile()).ReadAsync(doc))!.Revision);
        }
        finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}

