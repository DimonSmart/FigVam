using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Components;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ComponentCommandTests
{
    private sealed class TestProfile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind is "test" or "leaf";
        public bool CanContainChildren(string kind) => kind == "test";
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-component-" + Guid.NewGuid());
        public Guid Id { get; } = Guid.NewGuid();
        public Guid Root { get; } = Guid.NewGuid();
        public Guid Child { get; } = Guid.NewGuid();
        public Guid Page { get; } = Guid.NewGuid();
        public Guid Screen { get; } = Guid.NewGuid();
        public DocumentActor Owner { get; } = new("owner");
        public DocumentActor Editor { get; } = new("editor");
        public SqliteDocumentJournal Journal => new(directory, new TestProfile());
        public DocumentCommandHandler Handler { get { var j = Journal; return new(j, j, new TestProfile()); } }
        public async Task Initialize()
        {
            await Journal.CreateAsync(new(Id), Owner);
            await Journal.SetMemberAsync(Id, Editor.Id, DocumentRole.Editor, Owner);
            await Journal.SetMemberAsync(Id, "viewer", DocumentRole.Viewer, Owner);
            Assert.True((await Handler.HandleAsync(new AddPageCommand(Id, Guid.NewGuid(), Page), Editor)).Accepted);
            Assert.True((await Handler.HandleAsync(new AddScreenCommand(Id, Guid.NewGuid(), Page, Screen, new(800, 600)), Editor)).Accepted);
            Assert.True((await Handler.HandleAsync(new AddNodeCommand(Id, Guid.NewGuid(), Screen, Root, "test"), Editor)).Accepted);
            Assert.True((await Handler.HandleAsync(new AddNodeCommand(Id, Guid.NewGuid(), Root, Child, "test"), Editor)).Accepted);
        }
        public AddComponentDefinitionCommand Command(Guid? componentId = null) => new(Id, Guid.NewGuid(), componentId ?? Guid.NewGuid(), "Card", "Reusable card", Root);
        public void Dispose() => Directory.Delete(directory, true);
    }

    private static async Task<InsertComponentInstanceCommand> InstanceCommand(Fixture f)
    {
        var definition = f.Command();
        Assert.True((await f.Handler.HandleAsync(definition, f.Editor)).Accepted);
        return new(f.Id, Guid.NewGuid(), Guid.NewGuid(), definition.ComponentId, f.Screen, 0);
    }

    [Fact]
    public async Task DetachmentIsDurableIdempotentAndRetainsAllocatedIdsAcrossHistoryAndSnapshots()
    {
        using var f = new Fixture(); await f.Initialize();
        var insert = await InstanceCommand(f);
        Assert.True((await f.Handler.HandleAsync(insert, f.Editor)).Accepted);
        var before = (await f.Journal.ReadAsync(f.Id))!;
        var command = new DetachComponentInstanceCommand(f.Id, Guid.NewGuid(), insert.NodeId, before.Revision);
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var response = Assert.IsType<OkObjectResult>(await controller.DetachComponentInstance(f.Id, new() { CommandId = command.CommandId, NodeId = command.NodeId, ExpectedRevision = command.ExpectedRevision }, default));
        var result = await f.Handler.HandleAsync(command, f.Owner);
        Assert.Equal(result, await f.Handler.HandleAsync(command with { NodeId = f.Root, ExpectedRevision = 0 }, f.Owner));
        Assert.Equal(before.Revision + 1, result.Revision);
        Assert.Contains(insert.NodeId, Assert.IsType<CommandResponse>(response.Value).AffectedIds);
        var detached = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Empty(detached.Document.ComponentInstances);
        var anchor = detached.Document.Nodes.Single(n => n.Id == insert.NodeId);
        var copiedChild = Assert.Single(anchor.ChildIds);
        Assert.NotEqual(f.Child, copiedChild);
        Assert.Contains(copiedChild, result.AffectedIds!);
        Assert.Equal(before.Document.Screens.Single().ChildIds, detached.Document.Screens.Single().ChildIds);
        var committed = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, before.Revision)).Events!);
        Assert.Equal("DETACH_COMPONENT_INSTANCE", committed.Type);
        Assert.Equal(command.NodeId, Assert.IsType<ComponentInstanceDetached>(committed.Payload).NodeId);
        Assert.Equal(JsonSerializer.Serialize(detached), JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(before.Document), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document));
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(detached.Document), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document));
        for (var i = 0; i < 30; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), f.Editor)).Accepted);
        Assert.Equal(copiedChild, Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.Nodes.Single(n => n.Id == insert.NodeId).ChildIds));
        Assert.Equal(result, await f.Handler.HandleAsync(command, f.Owner));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal(31, (await f.Journal.ReadAsync(f.Id))!.Document.Pages.Count);
        Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
    }

    [Fact]
    public async Task DetachmentRejectionsAndUnsafeHistoryDoNotChangeRevisionOrForeignWork()
    {
        using var f = new Fixture(); await f.Initialize();
        var insert = await InstanceCommand(f);
        Assert.True((await f.Handler.HandleAsync(insert, f.Editor)).Accepted);
        var revision = (await f.Journal.ReadAsync(f.Id))!.Revision;
        var command = new DetachComponentInstanceCommand(f.Id, Guid.NewGuid(), insert.NodeId, revision);
        foreach (var (bad, code) in new[] {
            (command with { ExpectedRevision = revision - 1 }, "REVISION_CONFLICT"),
            (command with { ExpectedRevision = revision + 1 }, "REVISION_CONFLICT"),
            (command with { ExpectedRevision = -1 }, "INVALID_REVISION"),
            (command with { NodeId = f.Root }, "NOT_COMPONENT_INSTANCE"),
            (command with { NodeId = Guid.NewGuid() }, "NODE_NOT_FOUND"),
            (command with { NodeId = Guid.Empty }, "INVALID_ID") })
            Assert.Equal(code, (await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, f.Owner)).Code);
        foreach (var actor in new[] { "viewer", "outsider" }) Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new(actor))).Code);
        Assert.Equal(revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.True((await f.Handler.HandleAsync(command, f.Owner)).Accepted);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        var child = Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.Nodes.Single(n => n.Id == insert.NodeId).ChildIds);
        Assert.True((await f.Handler.HandleAsync(new SetNodeNameCommand(f.Id, Guid.NewGuid(), child, "foreign"), f.Editor)).Accepted);
        revision = (await f.Journal.ReadAsync(f.Id))!.Revision;
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Code);
        Assert.Equal(revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.Equal("foreign", (await f.Journal.ReadAsync(f.Id))!.Document.Nodes.Single(n => n.Id == child).Name);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new SetNodeNameCommand(f.Id, Guid.NewGuid(), insert.NodeId, "foreign anchor"), f.Editor)).Accepted);
        revision = (await f.Journal.ReadAsync(f.Id))!.Revision;
        Assert.Equal("REDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Code);
        Assert.Equal(revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
    }

    [Fact]
    public async Task InstancesSurviveReplaySnapshotsVersionsReconnectAndSafeHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = await InstanceCommand(f);
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var response = Assert.IsType<OkObjectResult>(await controller.InsertComponentInstance(f.Id, new() { CommandId = command.CommandId, NodeId = command.NodeId, DefinitionId = command.DefinitionId, ParentId = command.ParentId, Position = command.Position }, default));
        Assert.Contains(command.NodeId, Assert.IsType<CommandResponse>(response.Value).AffectedIds);
        var result = await f.Handler.HandleAsync(command, f.Owner);
        Assert.Equal(result, await f.Handler.HandleAsync(command with { Position = 100 }, f.Owner));
        Assert.Equal("owner", result.ActorId);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Equal(command.NodeId, state.Document.Screens.Single().ChildIds[0]);
        Assert.Equal(command.DefinitionId, Assert.Single(state.Document.ComponentInstances).DefinitionId);
        Assert.Equal("test", state.Document.Nodes.Single(n => n.Id == command.NodeId).Kind);
        Assert.Empty(DocumentStructureValidator.Validate(state.Document, new TestProfile()));
        var committed = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, result.Revision!.Value - 1)).Events!);
        Assert.Equal("INSERT_COMPONENT_INSTANCE", committed.Type);
        Assert.Equal(command.NodeId, Assert.IsType<ComponentInstanceInserted>(committed.Payload).Instance.NodeId);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        var saved = await f.Handler.HandleAsync(new SaveDocumentCommand(f.Id, Guid.NewGuid(), "instance"), f.Owner);
        for (var i = 0; i < 30; i++) Assert.True((await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), NodeId = Guid.NewGuid() }, f.Editor)).Accepted);
        Assert.Equal(31, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Count);
        Assert.Single((await f.Journal.ReadVersionAsync(f.Id, saved.VersionId!.Value)).Version!.Snapshot.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(new RestoreDocumentVersionCommand(f.Id, Guid.NewGuid(), saved.VersionId.Value), f.Owner)).Accepted);
        Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal(31, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Count);
    }

    [Fact]
    public async Task InvalidInstanceRequestsAreAtomicAndForeignEditsPreventUndo()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = await InstanceCommand(f);
        var revision = (await f.Journal.ReadAsync(f.Id))!.Revision;
        foreach (var (bad, code) in new[] {
            (command with { DefinitionId = Guid.NewGuid() }, "COMPONENT_NOT_FOUND"),
            (command with { DefinitionId = f.Root }, "COMPONENT_NOT_FOUND"),
            (command with { ParentId = Guid.NewGuid() }, "PARENT_NOT_FOUND"),
            (command with { ParentId = f.Page }, "INVALID_PARENT_TYPE"),
            (command with { Position = -1 }, "INVALID_POSITION"),
            (command with { Position = 2 }, "INVALID_POSITION"),
            (command with { ParentId = f.Root }, "CYCLE_NOT_ALLOWED"),
            (command with { NodeId = command.DefinitionId }, "DUPLICATE_ID"),
            (command with { NodeId = f.Root }, "DUPLICATE_ID"),
            (command with { NodeId = Guid.Empty }, "INVALID_ID") })
            Assert.Equal(code, (await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, f.Owner)).Code);
        foreach (var actor in new[] { "viewer", "outsider" }) Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new(actor))).Code);
        Assert.Equal(revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(command, f.Owner)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Code);
        Assert.True((await f.Handler.HandleAsync(new SetNodeNameCommand(f.Id, Guid.NewGuid(), command.NodeId, "foreign"), f.Editor)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Code);
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new MoveNodeCommand(f.Id, Guid.NewGuid(), command.NodeId, f.Screen, f.Root, 0), f.Owner)).Code);
        Assert.True((await f.Handler.HandleAsync(new DeleteNodeCommand(f.Id, Guid.NewGuid(), command.NodeId), f.Editor)).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Accepted);
        Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.Equal("foreign", (await f.Journal.ReadAsync(f.Id))!.Document.Nodes.Single(n => n.Id == command.NodeId).Name);
    }

    [Fact]
    public async Task ContainerInsertionAndSubtreeDeletionPreserveBindingsAndRejectLeafParents()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = await InstanceCommand(f);
        var container = Guid.NewGuid(); var leaf = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Screen, container, "test"), f.Editor)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Screen, leaf, "leaf"), f.Editor)).Accepted);
        Assert.Equal("CHILDREN_NOT_ALLOWED", (await f.Handler.HandleAsync(command with { ParentId = leaf }, f.Owner)).Code);
        Assert.True((await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), ParentId = container }, f.Owner)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new DeleteNodeCommand(f.Id, Guid.NewGuid(), container), f.Editor)).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Accepted);
        Assert.Equal(command.NodeId, Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances).NodeId);
        Assert.Empty(DocumentStructureValidator.Validate((await f.Journal.ReadAsync(f.Id))!.Document, new TestProfile()));
    }

    [Fact]
    public void InstanceValuesRetainTheirTypesInDocumentSerialization()
    {
        var documentId = Guid.NewGuid(); var screenId = Guid.NewGuid();
        var rootId = Guid.NewGuid(); var anchorId = Guid.NewGuid(); var definitionId = Guid.NewGuid(); var parameterId = Guid.NewGuid();
        var document = new DocumentStructure(documentId, [], [new(screenId, [rootId, anchorId], new(800, 600))], [new(rootId, "test", []), new(anchorId, "test", [])])
        {
            ComponentDefinitions = [new(definitionId, "Card", "", rootId, [new(parameterId, "active", ComponentParameterType.Bool, new ComponentBool(false))], [], [])],
            ComponentInstances = [new(anchorId, definitionId, null, new Dictionary<Guid, ComponentValue> { [parameterId] = new ComponentBool(true) }, new Dictionary<Guid, IReadOnlyList<Guid>>())]
        };
        var restored = JsonSerializer.Deserialize<DocumentStructure>(JsonSerializer.Serialize(document))!;
        Assert.True(Assert.IsType<ComponentBool>(Assert.Single(restored.ComponentInstances).ParameterOverrides[parameterId]).Value);
        Assert.False(Assert.IsType<ComponentBool>(Assert.Single(restored.ComponentDefinitions).Parameters.Single().DefaultValue).Value);
        Assert.Empty(DocumentStructureValidator.Validate(restored, new TestProfile()));
    }

    [Fact]
    public async Task InstanceRedoRequiresTheDefinitionAndParentToRemainValid()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = await InstanceCommand(f);
        Assert.True((await f.Handler.HandleAsync(command, f.Owner)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Accepted);
        var revision = (await f.Journal.ReadAsync(f.Id))!.Revision;
        Assert.Equal("REDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Code);
        Assert.Equal(revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
    }

    [Fact]
    public async Task DefinitionsSurviveReplaySnapshotsVersionsAndHistoryWithoutChangingTheTree()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = f.Command();
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var response = Assert.IsType<OkObjectResult>(await controller.AddComponentDefinition(f.Id, new() { CommandId = command.CommandId, ComponentId = command.ComponentId, RootNodeId = command.RootNodeId, Name = command.Name, Description = command.Description }, default));
        Assert.Equal(command.ComponentId, Assert.Single(Assert.IsType<CommandResponse>(response.Value).AffectedIds));
        var original = await f.Handler.HandleAsync(command, f.Owner);
        Assert.Equal(original, await f.Handler.HandleAsync(command with { Name = "ignored" }, f.Owner));
        var state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Equal(5, state.Revision);
        var definition = Assert.Single(state.Document.ComponentDefinitions);
        Assert.Equal(command.ComponentId, definition.Id); Assert.Equal(command.Name, definition.Name);
        Assert.Equal(command.Description, definition.Description); Assert.Equal(f.Root, definition.RootNodeId);
        Assert.Equal(f.Root, Assert.Single(Assert.Single(state.Document.Screens).ChildIds));
        Assert.Equal(f.Child, Assert.Single(state.Document.Nodes.Single(n => n.Id == f.Root).ChildIds));
        Assert.Empty(definition.Parameters); Assert.Empty(definition.Slots); Assert.Empty(definition.Variants);
        var committed = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, 4)).Events!);
        Assert.Equal("ADD_COMPONENT_DEFINITION", committed.Type);
        Assert.Equal(command.ComponentId, Assert.IsType<ComponentDefinitionAdded>(committed.Payload).Definition.Id);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        var saved = await f.Handler.HandleAsync(new SaveDocumentCommand(f.Id, Guid.NewGuid(), "component"), f.Owner);
        Assert.True(saved.Accepted);
        for (var i = 0; i < 30; i++) Assert.True((await f.Handler.HandleAsync(f.Command(), f.Editor)).Accepted);
        Assert.Equal(31, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Count);
        Assert.Single((await f.Journal.ReadVersionAsync(f.Id, saved.VersionId!.Value)).Version!.Snapshot.Document.ComponentDefinitions);
        Assert.True((await f.Handler.HandleAsync(new RestoreDocumentVersionCommand(f.Id, Guid.NewGuid(), saved.VersionId.Value), f.Owner)).Accepted);
        Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal(31, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Count);
    }

    [Fact]
    public async Task RejectionsAndCrossKindIdCollisionsLeaveRevisionUnchanged()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = f.Command(); var result = await f.Handler.HandleAsync(command, f.Owner);
        foreach (var id in new[] { f.Id, f.Page, f.Screen, f.Root, command.ComponentId })
            Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(f.Command(id), f.Owner)).Code);
        foreach (var bad in new[] { command with { ComponentId = Guid.Empty }, command with { RootNodeId = Guid.Empty }, command with { RootNodeId = Guid.NewGuid() }, command with { RootNodeId = f.Screen }, command with { Name = "" }, command with { Name = "bad\nname" }, command with { Name = new string('x', 257) }, command with { Description = null! }, command with { Description = new string('x', 4097) } })
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, f.Owner)).Accepted);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("outsider"))).Code);
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), command.ComponentId), f.Owner)).Code);
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddScreenCommand(f.Id, Guid.NewGuid(), f.Page, command.ComponentId, new(800, 600)), f.Owner)).Code);
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Screen, command.ComponentId, "test"), f.Owner)).Code);
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new DeleteNodeCommand(f.Id, Guid.NewGuid(), f.Root), f.Editor)).Code);
        Assert.Equal(result.Revision, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.Single((await f.Journal.ReadHistoryAsync(f.Id, f.Owner.Id)).Entries!);
    }

    [Fact]
    public async Task UndoOfRootCreationIsUnsafeAndRedoRejectsDeletedRoot()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = f.Command() with { RootNodeId = f.Child };
        Assert.True((await f.Handler.HandleAsync(command, f.Owner)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Editor)).Code);
        Assert.Equal(5, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.True((await f.Handler.HandleAsync(new SetNodeNameCommand(f.Id, Guid.NewGuid(), f.Child, "foreign edit"), f.Editor)).Accepted);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Accepted);
        Assert.Equal("foreign edit", (await f.Journal.ReadAsync(f.Id))!.Document.Nodes.Single(n => n.Id == f.Child).Name);
        Assert.True((await f.Handler.HandleAsync(new DeleteNodeCommand(f.Id, Guid.NewGuid(), f.Child), f.Editor)).Accepted);
        Assert.Equal("REDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), f.Owner)).Code);
        Assert.Equal(8, (await f.Journal.ReadAsync(f.Id))!.Revision);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions);
    }

    [Fact]
    public async Task HttpContractPublishesSchemaAndRejectsMissingSubtreesAndUnauthorizedAccess()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-component-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid();
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var route = $"/api/v1/documents/{id}/commands/add-component-definition";
            var payload = new { commandId = Guid.NewGuid(), componentId = Guid.NewGuid(), rootNodeId = Guid.NewGuid(), name = "Card", description = "" };
            using var schemaDocument = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddComponentDefinitionRequest.json"));
            var schema = JsonSchema.Build(schemaDocument.RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            Assert.Contains("add-component-definition", await client.GetStringAsync("/openapi/v1.json"));
            Assert.Contains("componentDefinitions", await client.GetStringAsync("/api/v1/schemas/DocumentStructure.json"));
            Assert.Contains("rootNodeId", await client.GetStringAsync("/api/v1/schemas/ComponentDefinition.json"));
            using var missing = await client.PostAsJsonAsync(route, payload);
            Assert.Equal(404, (int)missing.StatusCode);
            Assert.Equal("NODE_NOT_FOUND", (await missing.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, new { commandId = Guid.NewGuid(), componentId = Guid.NewGuid(), rootNodeId = Guid.NewGuid(), name = "Card" })).StatusCode);
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            foreach (var actor in new[] { "viewer", "outsider" })
            {
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            }
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var instancePayload = new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), definitionId = Guid.NewGuid(), parentId = Guid.NewGuid(), position = 0 };
            var instanceRoute = $"/api/v1/documents/{id}/commands/insert-component-instance";
            using var instanceSchemaDocument = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/InsertComponentInstanceRequest.json"));
            var instanceSchema = JsonSchema.Build(instanceSchemaDocument.RootElement.Clone());
            Assert.True(instanceSchema.EvaluateNode(JsonSerializer.SerializeToNode(instancePayload)!).IsValid);
            Assert.False(instanceSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            Assert.Contains("componentInstances", await client.GetStringAsync("/api/v1/schemas/DocumentStructure.json"));
            Assert.Contains("insert-component-instance", await client.GetStringAsync("/openapi/v1.json"));
            using var missingInstance = await client.PostAsJsonAsync(instanceRoute, instancePayload);
            Assert.Equal(404, (int)missingInstance.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await missingInstance.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(instanceRoute, new { instancePayload.commandId, instancePayload.nodeId, instancePayload.definitionId, instancePayload.parentId, instancePayload.position, actorId = "editor" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(instanceRoute, instancePayload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(instanceRoute, instancePayload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var detachRoute = $"/api/v1/documents/{id}/commands/detach-component-instance";
            var detachPayload = new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), expectedRevision = 0 };
            using var detachSchemaDocument = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DetachComponentInstanceRequest.json"));
            var detachSchema = JsonSchema.Build(detachSchemaDocument.RootElement.Clone());
            Assert.True(detachSchema.EvaluateNode(JsonSerializer.SerializeToNode(detachPayload)!).IsValid);
            Assert.False(detachSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            Assert.False(detachSchema.EvaluateNode(JsonSerializer.SerializeToNode(new { detachPayload.commandId, detachPayload.nodeId, expectedRevision = -1 })!).IsValid);
            Assert.Contains("detach-component-instance", await client.GetStringAsync("/openapi/v1.json"));
            Assert.Contains("REVISION_CONFLICT", await client.GetStringAsync("/openapi/v1.json"));
            using var missingDetach = await client.PostAsJsonAsync(detachRoute, detachPayload);
            Assert.Equal(404, (int)missingDetach.StatusCode);
            Assert.Equal("NODE_NOT_FOUND", (await missingDetach.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(detachRoute, new { detachPayload.commandId, detachPayload.nodeId })).StatusCode);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(detachRoute, new { detachPayload.commandId, detachPayload.nodeId, detachPayload.expectedRevision, actorId = "editor" })).StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(detachRoute, detachPayload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(detachRoute, detachPayload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new VisualNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}

