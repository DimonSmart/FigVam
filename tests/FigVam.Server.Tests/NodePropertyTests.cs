using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class NodePropertyTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-properties-" + Guid.NewGuid());
    private readonly Guid documentId = Guid.NewGuid();
    private readonly Guid nodeId = Guid.NewGuid();
    private readonly DocumentActor alice = new("alice");
    private readonly DocumentActor bob = new("bob");
    private sealed class TestProfile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind == "test-node";
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => kind != "test-node" ? null : property switch
        {
            "text" => new(NodePropertyType.String),
            "visible" => new(NodePropertyType.Boolean),
            "width" => new(NodePropertyType.Number, value => ((NodeNumberValue)value).Value >= 0 ? null : "Negative width is unsupported by the test targets."),
            _ => null
        };
    }
    private sealed class Authorization(bool edit = true) : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(edit);
    }
    private SqliteDocumentJournal Journal() => new(directory, new TestProfile());
    private DocumentCommandHandler Handler(bool edit = true) => new(new Authorization(edit), Journal(), new TestProfile());
    private Task Seed() => Journal().InitializeAsync(new(documentId, [], [new(Guid.NewGuid(), [nodeId], new(800, 600))], [new(nodeId, "test-node", [])]));
    private SetNodePropertyCommand Set(string property, NodePropertyValue value) => new(documentId, Guid.NewGuid(), nodeId, property, value);
    private async Task<NodePropertyValue> Read(string property) => Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties[property];

    [Fact]
    public async Task TypedWritesAreOrderedDurableAndDeliveredOnReconnect()
    {
        await Seed();
        var command = Set("text", new NodeStringValue("first"));
        var accepted = await Handler().HandleAsync(command, alice);
        Assert.Equal(accepted, await Handler().HandleAsync(command with { Value = new NodeStringValue("retry") }, alice));
        var writes = Enumerable.Range(0, 5).Select(i => Handler().HandleAsync(Set("text", new NodeStringValue(i.ToString())), new("actor-" + i))).ToArray();
        var results = await Task.WhenAll(writes);
        var last = Array.FindIndex(results, r => r.Revision == results.Max(x => x.Revision));
        Assert.Equal(new NodeStringValue(last.ToString()), await Read("text"));
        Assert.True((await Handler().HandleAsync(Set("width", new NodeNumberValue(12.5)), alice)).Accepted);
        Assert.True((await Handler().HandleAsync(Set("visible", new NodeBooleanValue(false)), alice)).Accepted);
        var reconnect = await new DocumentReconnectReader(new Authorization(), Journal()).ReadAsync(documentId, 0, alice);
        Assert.Equal("EVENTS", reconnect.Code);
        Assert.Equal(8, reconnect.Events!.Count);
        Assert.Equal("SET_NODE_PROPERTY", reconnect.Events[0].Type);
        Assert.Equal(new NodePropertySet(nodeId, "text", new NodeStringValue("first")), reconnect.Events[0].Payload);
        Assert.Equal(8, (await Journal().ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task RejectionsReportTargetPropertyAndReasonAndAreIdempotent()
    {
        await Seed();
        var cases = new[] {
            (Set("unknown", new NodeStringValue("x")), "UNSUPPORTED_PROPERTY"),
            (Set("text", new NodeNumberValue(3)), "INVALID_PROPERTY_TYPE"),
            (Set("width", new NodeNumberValue(-1)), "INVALID_PROPERTY_VALUE"),
            (Set("width", new NodeNumberValue(double.NaN)), "INVALID_PROPERTY_VALUE"),
            (Set("text", new NodeStringValue(null!)), "INVALID_PROPERTY_VALUE") };
        foreach (var (command, code) in cases)
        {
            var result = await Handler().HandleAsync(command, alice);
            Assert.Equal(code, result.Code);
            Assert.Equal(nodeId, result.NodeId);
            Assert.Equal(command.Property, result.Property);
            Assert.False(string.IsNullOrWhiteSpace(result.Explanation));
            Assert.Equal(result, await Handler().HandleAsync(command with { Property = "text", Value = new NodeStringValue("valid") }, alice));
        }
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(Set("text", new NodeStringValue("x")), alice)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Empty(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties);
    }

    [Fact]
    public async Task DeletedNodeIsNeverResurrectedByPropertyWrite()
    {
        await Seed();
        var deletion = Handler().HandleAsync(new DeleteNodeCommand(documentId, Guid.NewGuid(), nodeId), bob);
        var write = Handler().HandleAsync(Set("text", new NodeStringValue("race")), alice);
        await Task.WhenAll(deletion, write);
        Assert.True((await deletion).Accepted);
        Assert.Contains((await write).Code, new[] { "ACCEPTED", "NODE_NOT_FOUND" });
        Assert.Equal("NODE_NOT_FOUND", (await Handler().HandleAsync(Set("text", new NodeStringValue("late")), alice)).Code);
        Assert.Empty((await Journal().ReadAsync(documentId))!.Document.Nodes);
    }

    [Fact]
    public async Task SnapshotRecoveryAndVersionRestorePreserveTypedProperties()
    {
        await Seed();
        await Handler().HandleAsync(Set("width", new NodeNumberValue(10)), alice);
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(documentId, Guid.NewGuid(), "ten"), alice);
        for (var i = 3; i <= 33; i++) await Handler().HandleAsync(Set("width", new NodeNumberValue(i)), bob);
        Assert.Equal(new NodeNumberValue(33), await Read("width"));
        using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, $"{documentId:N}.sqlite"), Pooling = false }.ToString()))
        {
            connection.Open();
            using var query = connection.CreateCommand();
            query.CommandText = "DELETE FROM events WHERE revision<=32";
            query.ExecuteNonQuery();
        }
        Assert.Equal(new NodeNumberValue(33), await Read("width"));
        var reconnect = await Journal().ReadEventsAsync(documentId, 0);
        Assert.Equal("SNAPSHOT", reconnect.Code);
        Assert.Equal(new NodeNumberValue(33), Assert.Single(reconnect.Snapshot!.Document.Nodes).Properties["width"]);
        var version = (await Journal().ReadVersionAsync(documentId, saved.VersionId!.Value)).Version!;
        Assert.Equal(new NodeNumberValue(10), Assert.Single(version.Snapshot.Document.Nodes).Properties["width"]);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(documentId, Guid.NewGuid(), version.Id), alice)).Accepted);
        Assert.Equal(new NodeNumberValue(10), await Read("width"));
    }

    [Fact]
    public async Task UndoRedoRecoverAndRefuseToOverwriteAnotherActorsEdit()
    {
        await Seed();
        await Handler().HandleAsync(Set("text", new NodeStringValue("alice")), alice);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), alice)).Accepted);
        Assert.Empty(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), alice)).Accepted);
        Assert.Equal(new NodeStringValue("alice"), await Read("text"));
        await Handler().HandleAsync(Set("text", new NodeStringValue("bob")), bob);
        var revision = (await Journal().ReadAsync(documentId))!.Revision;
        var refused = await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), alice);
        Assert.Equal("UNDO_NOT_APPLICABLE", refused.Code);
        Assert.NotNull(refused.Explanation);
        Assert.Equal(revision, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Equal(new NodeStringValue("bob"), await Read("text"));
    }

    [Fact]
    public async Task ConfirmedPropertySurvivesAbruptProcessExit()
    {
        Directory.CreateDirectory(directory);
        var command = Set("text", new NodeStringValue("durable"));
        var start = new System.Diagnostics.ProcessStartInfo("dotnet")
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true
        };
        start.ArgumentList.Add("vstest");
        start.ArgumentList.Add(typeof(NodePropertyTests).Assembly.Location);
        start.ArgumentList.Add("--TestCaseFilter:FullyQualifiedName=FigVam.Server.Tests.NodePropertyTests.PropertyCrashWriter");
        start.Environment["FIGVAM_PROPERTY_CRASH_DIRECTORY"] = directory;
        start.Environment["FIGVAM_PROPERTY_CRASH_COMMAND"] = JsonSerializer.Serialize(command);
        using var process = System.Diagnostics.Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            await Task.WhenAll(output, error);
            throw;
        }
        Assert.NotEqual(0, process.ExitCode);
        Assert.True(File.Exists(Path.Combine(directory, "property-result.json")), await output + await error);
        var result = JsonSerializer.Deserialize<CommandResult>(await File.ReadAllTextAsync(Path.Combine(directory, "property-result.json")));
        var recovered = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(1, recovered.Revision);
        Assert.Equal(command.Value, Assert.Single(recovered.Document.Nodes).Properties[command.Property]);
        Assert.Equal(result, await Handler().HandleAsync(command, alice));
    }

    [Fact]
    public async Task PropertyCrashWriter()
    {
        var crashDirectory = Environment.GetEnvironmentVariable("FIGVAM_PROPERTY_CRASH_DIRECTORY");
        if (crashDirectory is null) return;
        var command = JsonSerializer.Deserialize<SetNodePropertyCommand>(Environment.GetEnvironmentVariable("FIGVAM_PROPERTY_CRASH_COMMAND")!)!;
        var journal = new SqliteDocumentJournal(crashDirectory, new TestProfile());
        await journal.InitializeAsync(new(command.DocumentId, [], [new(Guid.NewGuid(), [command.NodeId], new(800, 600))], [new(command.NodeId, "test-node", [])]));
        var result = await new DocumentCommandHandler(new Authorization(), journal, new TestProfile()).HandleAsync(command, new("alice"));
        await File.WriteAllTextAsync(Path.Combine(crashDirectory, "property-result.json"), JsonSerializer.Serialize(result));
        Environment.Exit(23);
    }

    [Fact]
    public void ModelValidationUsesTheSameProfileAndSerializationIsDeterministic()
    {
        var first = new NodeStructure(nodeId, "test-node", []) { Properties = new NodeStructure(nodeId, "test-node", []).Properties
            .Add("visible", new NodeBooleanValue(true)).Add("text", new NodeStringValue("hello")) };
        var second = first with { Properties = first.Properties.Clear().Add("text", new NodeStringValue("hello")).Add("visible", new NodeBooleanValue(true)) };
        Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(second));
        Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(JsonSerializer.Deserialize<NodeStructure>(JsonSerializer.Serialize(first))));
        var document = new DocumentStructure(documentId, [], [new(Guid.NewGuid(), [nodeId], new(800, 600))], [first with { Properties = first.Properties.Add("width", new NodeNumberValue(-1)) }]);
        var error = Assert.Single(DocumentStructureValidator.Validate(document, new TestProfile()));
        Assert.Equal(nodeId, error.ObjectId);
        Assert.Equal("width", error.Property);
        Assert.Equal("INVALID_PROPERTY_VALUE", error.Code);
    }
    [Fact]
    public async Task MetadataIsDurableIdempotentAndSupportsSafeHistory()
    {
        await Seed();
        var set = new SetNodeNameCommand(documentId, Guid.NewGuid(), nodeId, "Button");
        var first = await Handler().HandleAsync(set, alice);
        Assert.True(first.Accepted);
        Assert.Equal(first, await Handler().HandleAsync(set with { Name = "retry" }, alice));
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(set, alice)).Code);
        Assert.Equal("INVALID_NODE_METADATA", (await Handler().HandleAsync(set with { CommandId = Guid.NewGuid(), Name = new string('x', 257) }, alice)).Code);
        Assert.Equal("INVALID_NODE_METADATA", (await Handler().HandleAsync(new SetNodeSemanticKeyCommand(documentId, Guid.NewGuid(), nodeId, " "), alice)).Code);
        Assert.True((await Handler().HandleAsync(new SetNodeSemanticKeyCommand(documentId, Guid.NewGuid(), nodeId, "submit"), alice)).Accepted);
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(documentId, Guid.NewGuid()), alice);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), alice)).Accepted);
        Assert.Null(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).SemanticKey);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), alice)).Accepted);
        await Handler().HandleAsync(set with { CommandId = Guid.NewGuid(), Name = "Bob" }, bob);
        var revision = (await Journal().ReadAsync(documentId))!.Revision;
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), alice)).Code);
        Assert.Equal(revision, (await Journal().ReadAsync(documentId))!.Revision);
        var events = (await Journal().ReadEventsAsync(documentId, 0)).Events!;
        Assert.Equal(new NodeNameSet(nodeId, "Button"), events[0].Payload);
        Assert.Equal(new NodeSemanticKeySet(nodeId, "submit"), events[1].Payload);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(documentId, Guid.NewGuid(), saved.VersionId!.Value), alice)).Accepted);
        for (var i = 0; i < 33; i++) await Handler().HandleAsync(set with { CommandId = Guid.NewGuid(), Name = "Button" }, bob);
        var node = Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes);
        Assert.Equal(nodeId, node.Id); Assert.Equal("Button", node.Name); Assert.Equal("submit", node.SemanticKey);
        Assert.Contains(nodeId, Assert.Single((await Journal().ReadAsync(documentId))!.Document.Screens).ChildIds);
        Assert.True((await Handler().HandleAsync(new SetNodeSemanticKeyCommand(documentId, Guid.NewGuid(), nodeId, null), alice)).Accepted);
        Assert.Null(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).SemanticKey);
        Assert.Equal("NODE_NOT_FOUND", (await Handler().HandleAsync(set with { CommandId = Guid.NewGuid(), NodeId = Guid.NewGuid() }, alice)).Code);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
