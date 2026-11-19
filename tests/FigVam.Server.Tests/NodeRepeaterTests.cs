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
public sealed partial class NodeRepeaterTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-repeater-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), owner = Guid.NewGuid(), template = Guid.NewGuid(), empty = Guid.NewGuid(), dataset = Guid.NewGuid(), screen = Guid.NewGuid();
    private readonly DocumentActor actor = new("owner");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind is "container" or "text";
        public bool CanContainChildren(string kind) => kind == "container";
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch {
            "text" or "text1" or "text2" or "text3" => new(NodePropertyType.String), "visible" => new(NodePropertyType.Boolean), "count" => new(NodePropertyType.Number), _ => null };
    }
    private sealed class Authorization(bool edit = true, bool read = true) : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor a, Guid id, CancellationToken ct) => ValueTask.FromResult(read);
        public ValueTask<bool> CanEditAsync(DocumentActor a, Guid id, CancellationToken ct) => ValueTask.FromResult(edit);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler(bool edit = true) => new(new Authorization(edit), Journal(), new Profile());
    private DocumentRepeaterQueries Queries(bool read = true) => new(new Authorization(read: read), Journal(), new Profile());
    private NodeRepeater Config() => new(dataset, new([new DataProperty("rows")], ExpectedType: DataExpectedType.Array), template, empty,
        [new(template, "text", new([new DataProperty("person"), new DataProperty("name")], ExpectedType: DataExpectedType.String))]);
    private SetNodeRepeaterCommand Command(long revision = 0, NodeRepeater? config = null) => new(doc, Guid.NewGuid(), owner, revision, config ?? Config());
    private DocumentStructure Document(string fixture) => new(doc, [], [new(screen, [owner], new(800, 600))],
        [new(owner, "container", [template, empty]), new(template, "text", []), new(empty, "text", [])]) { Datasets = [new(dataset, "rows", fixture)] };
    private Task Seed(string fixture = "{\"rows\":[{\"person\":{\"name\":\"Alice\"}},{\"person\":{\"name\":\"Bob\"}}]}") => Journal().InitializeAsync(Document(fixture));

    [Theory]
    [InlineData("{\"rows\":[]}", 0)]
    [InlineData("{\"rows\":[{\"person\":{\"name\":\"Alice\"}}]}", 1)]
    [InlineData("{\"rows\":[{\"person\":{\"name\":\"Alice\"}},{\"person\":{\"name\":\"Bob\"}}]}", 2)]
    public async Task ZeroOneManyAreStableAndRevisionAware(string fixture, int count)
    {
        await Seed(fixture); var command = Command(); var accepted = await Handler().HandleAsync(command, actor);
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await Handler().HandleAsync(command with { ExpectedRevision = 999, Repeater = null }, actor));
        var evaluated = (await Queries().EvaluateAsync(doc, owner, 1, 0, 100, actor)).Response!;
        Assert.Equal(count, evaluated.Total); Assert.Null(evaluated.Diagnostic);
        Assert.Equal(count == 0 ? empty : (Guid?)null, evaluated.EmptyViewNodeId);
        if (count > 0) Assert.Equal(new NodeStringValue("Alice"), Assert.Single(evaluated.Items[0]).Value);
        if (count > 1) Assert.Equal(new NodeStringValue("Bob"), Assert.Single(evaluated.Items[1]).Value);
        Assert.Equal("REPEATER_NOT_FOUND", (await Queries().EvaluateAsync(doc, owner, 0, 0, 100, actor)).Code);
        Assert.Single((await Journal().ReadAsync(doc))!.Document.Nodes, n => n.Repeater is not null);
        var replay = Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!);
        Assert.Equal("SET_NODE_REPEATER", replay.Type); Assert.IsType<NodeRepeaterSet>(replay.Payload);
        Assert.True((await Handler().HandleAsync(new SetNodeRepeaterCommand(doc, Guid.NewGuid(), owner, 1, null), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(count, (await Queries().EvaluateAsync(doc, owner, null, 0, 100, actor)).Response!.Total);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal("REPEATER_NOT_FOUND", (await Queries().EvaluateAsync(doc, owner, null, 0, 100, actor)).Code);
        Assert.Equal(count, (await Queries().EvaluateAsync(doc, owner, 1, 0, 1, actor)).Response!.Total);
        Assert.Equal("repeater", Assert.Single(Assert.Single((await new DocumentRevisionDiff(new Authorization(), Journal()).CompareAsync(doc, 0, 1, 0, 10, actor)).Response!.Items).ChangedProperties));
    }

    [Theory]
    [InlineData("{}", "DATA_MISSING_VALUE")]
    [InlineData("{\"rows\":0}", "DATA_INCOMPATIBLE_TYPE")]
    [InlineData("{\"rows\":[{}]}", "DATA_MISSING_VALUE")]
    [InlineData("{\"rows\":[{\"person\":{\"name\":7}}]}", "DATA_INCOMPATIBLE_TYPE")]
    public async Task InvalidFixtureFieldsRejectConfigurationAndLaterReportDiagnostics(string fixture, string code)
    {
        await Seed(fixture); var rejected = await Handler().HandleAsync(Command(), actor);
        Assert.Equal(code, rejected.Code); Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 0, "{\"rows\":[]}"), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Command(1), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 2, fixture), actor)).Accepted);
        var evaluation = (await Queries().EvaluateAsync(doc, owner, null, 0, 10, actor)).Response!;
        Assert.Equal(code, evaluation.Diagnostic!.Code); Assert.Empty(evaluation.Items);
        var diagnostics = (await new DocumentDiagnostics(new Authorization(), Journal(), new Profile()).ReadAsync(doc, screen, null, 0, 100, actor)).Response!;
        Assert.Contains(diagnostics.Items, d => d.Code == code && d.ReferenceId == dataset);
    }

    [Fact]
    public async Task InvalidConfigurationPermissionsAndReferencesNeverChangeRevision()
    {
        await Seed(); var config = Config();
        var invalid = new[] {
            (config with { DatasetId = Guid.NewGuid() }, "DATASET_NOT_FOUND"),
            (config with { TemplateNodeId = empty }, "INVALID_REPEATER"),
            (config with { EmptyViewNodeId = owner }, "INVALID_REPEATER"),
            (config with { Items = new([], ExpectedType: DataExpectedType.Object) }, "INVALID_REPEATER"),
            (config with { Bindings = [new(empty, "text", new([], ExpectedType: DataExpectedType.String))] }, "INVALID_REPEATER"),
            (config with { Bindings = [config.Bindings[0], config.Bindings[0]] }, "INVALID_REPEATER"),
            (config with { Bindings = [new(template, "visible", config.Bindings[0].Binding)] }, "INVALID_PROPERTY_TYPE"),
            (config with { Bindings = [new(template, "text", new([new DataIndex(-1)], ExpectedType: DataExpectedType.String))] }, "INVALID_DATA_BINDING") };
        foreach (var (configuration, code) in invalid) { var command = Command(config: configuration); var result = await Handler().HandleAsync(command, actor); Assert.Equal(code, result.Code); Assert.Equal(result, await Handler().HandleAsync(command with { Repeater = Config() }, actor)); }
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(Command(), actor)).Code);
        Assert.Equal("FORBIDDEN", (await Queries(false).EvaluateAsync(doc, owner, 0, 0, 1, actor)).Code);
        Assert.Equal("REVISION_CONFLICT", (await Handler().HandleAsync(Command(9), actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        var unverified = new DocumentCommandHandler(new Authorization(), Journal(), new UnverifiedNodeProfile());
        Assert.False((await unverified.HandleAsync(Command(), actor)).Accepted);
    }

    [Fact]
    public async Task UsedStructuralElementsDatasetsAndHistoryAreProtected()
    {
        await Seed(); Assert.True((await Handler().HandleAsync(Command(), actor)).Accepted);
        Assert.Equal("DATASET_IN_USE", (await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 1), actor)).Code);
        Assert.Equal("INVALID_REPEATER", (await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), template), actor)).Code);
        Assert.Equal("INVALID_REPEATER", (await Handler().HandleAsync(new MoveNodeCommand(doc, Guid.NewGuid(), template, owner, screen, 0), actor)).Code);
        Assert.Equal("INVALID_REPEATER", (await Handler().HandleAsync(new BindNodeDataCommand(doc, Guid.NewGuid(), template, "text", new(dataset, new([new DataProperty("rows"), new DataIndex(0), new DataProperty("person"), new DataProperty("name")], ExpectedType: DataExpectedType.String))), actor)).Code);
        Assert.True((await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), owner), actor)).Accepted);
        var other = new DocumentActor("other");
        Assert.True((await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 2), other)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), other)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(2, (await Queries().EvaluateAsync(doc, owner, null, 0, 1, actor)).Response!.Total);
    }

    [Fact]
    public void SharedBudgetCoversExpansionPathsAndOwnership()
    {
        var config = Config() with { Bindings = [] };
        var document = Document("{\"rows\":[{},{}]}"); var node = document.Nodes[0];
        var chain = Enumerable.Range(0, 6000).Select(_ => Guid.NewGuid()).ToArray();
        document = document with { Nodes = [node, new(template, "container", [chain[0]]), document.Nodes[2], .. chain.Select((id, i) => new NodeStructure(id, "container", i == chain.Length - 1 ? [] : [chain[i + 1]]))] };
        Assert.Equal("DATA_REPEATER_LIMIT", NodeRepeaterEvaluator.Evaluate(document, node, config, new Profile()).Diagnostic!.Code);
        var shared = Document("{\"rows\":[]}"); shared = shared with { Screens = [new(screen, [owner, template], new(800, 600))] };
        Assert.Equal("INVALID_REPEATER", NodeRepeaterEvaluator.Validate(shared, shared.Nodes[0], config, new Profile())!.Code);
        var cycle = Document("{\"rows\":[]}"); cycle = cycle with { Nodes = cycle.Nodes.Select(n => n.Id == template ? n with { ChildIds = [owner] } : n).ToArray() };
        Assert.Equal("INVALID_REPEATER", NodeRepeaterEvaluator.Validate(cycle, cycle.Nodes[0], config, new Profile())!.Code);
    }

    [Fact]
    public async Task PathBudgetAndItemLimitRejectBeforeCommitAndSnapshotsRecover()
    {
        var fixture = JsonSerializer.Serialize(new { rows = Enumerable.Range(0, 1000).Select(_ => new { person = new { name = "x" } }) });
        await Seed(fixture);
        var config = Config();
        config = config with { Bindings = new[] { "text", "text1", "text2", "text3" }.Select(p => config.Bindings[0] with { Property = p }).ToArray() };
        Assert.Equal("DATA_REPEATER_LIMIT", (await Handler().HandleAsync(Command(config: config), actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 0, "{\"rows\":[" + string.Join(',', Enumerable.Repeat("{}", 1001)) + "]}"), actor)).Accepted);
        Assert.Equal("DATA_REPEATER_LIMIT", (await Handler().HandleAsync(Command(1, Config() with { Bindings = [] }), actor)).Code);
        Assert.True((await Handler().HandleAsync(new ReplaceDatasetFixtureCommand(doc, Guid.NewGuid(), dataset, 1, "{\"rows\":[]}"), actor)).Accepted);
        for (var revision = 2; revision < 36; revision++) Assert.True((await Handler().HandleAsync(Command(revision), actor)).Accepted);
        Assert.Null((await Queries().EvaluateAsync(doc, owner, 36, 0, 1, actor)).Response!.Diagnostic);
        Assert.Null((await Queries().EvaluateAsync(doc, owner, 3, 0, 1, actor)).Response!.Diagnostic);
        var structure = (await new DocumentStructureQueries(new Authorization(), Journal()).QueryAsync(doc, new("nodes", ObjectId: owner, Fields: "repeater", Revision: 3), actor)).Response!;
        Assert.NotNull(Assert.Single(structure.Items, item => item.Id == owner).Repeater);
    }

    [Fact]
    public async Task PublishedHttpSchemasAndPermissionsAreConsistent()
    {
        using var key = RSA.Create(2048); var config = Production(key); config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
        using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var request = new SetNodeRepeaterRequest { CommandId = Guid.NewGuid(), NodeId = owner, ExpectedRevision = 0, Repeater = Config() };
        var schema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/SetNodeRepeaterRequest.json"))!; schema["$id"] = "urn:test:" + Guid.NewGuid();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.True(JsonSchema.FromText(schema.ToJsonString()).EvaluateNode(JsonSerializer.SerializeToNode(request, options)!).IsValid);
        Assert.IsType<DataProperty>(JsonSerializer.Deserialize<SetNodeRepeaterRequest>(JsonSerializer.Serialize(request, options), options)!.Repeater!.Items.Path[0]);
        var openapi = await client.GetStringAsync("/openapi/v1.json"); Assert.Contains("/commands/set-node-repeater", openapi); Assert.Contains("/nodes/{nodeId}/repeater", openapi);
        Assert.Contains("templateNodes", openapi); Assert.Contains("emptyViewNodes", openapi);
        var componentDocument = ComponentDocument("{\"rows\":[{}]}");
        var resolved = NodeRepeaterEvaluator.Evaluate(componentDocument, componentDocument.Nodes[0], Config() with { Bindings = [] }, new Profile());
        var response = new RepeaterEvaluationResponse(doc, 1, owner, null, resolved.Items!, 0, 100, 1, null) { TemplateNodes = resolved.TemplateNodes };
        var responseSchema = JsonNode.Parse(await client.GetStringAsync("/api/v1/schemas/RepeaterEvaluationResponse.json"))!;
        responseSchema["$id"] = "urn:test:" + Guid.NewGuid();
        Assert.True(JsonSchema.FromText(responseSchema.ToJsonString()).EvaluateNode(JsonSerializer.SerializeToNode(response, options)!).IsValid);
        Assert.Equal(200, (int)(await client.GetAsync("/api/v1/schemas/ExpandedRepeaterNode.json")).StatusCode);
        Assert.Equal(404, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/set-node-repeater", request)).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync($"/api/v1/documents/{doc}/nodes/{owner}/repeater")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync($"/api/v1/documents/{doc}/nodes/{owner}/repeater?unexpected=1")).StatusCode);
        Assert.Equal(200, (int)(await client.PutAsJsonAsync($"/api/v1/documents/{doc}/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(403, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{doc}/commands/set-node-repeater", request)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "stranger"));
        Assert.Equal(403, (int)(await client.GetAsync($"/api/v1/documents/{doc}/nodes/{owner}/repeater")).StatusCode);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
