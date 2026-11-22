using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

public sealed partial class ComponentParameterCommandTests
{
    [Fact]
    public async Task SlotsResolveDetachReplayAndGuardHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var slot = Guid.NewGuid(); var content = Guid.NewGuid(); var descendant = Guid.NewGuid();
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var add = new AddComponentSlotCommand(f.Id, Guid.NewGuid(), f.Definition, new(slot, "Body", f.Child));
        Assert.IsType<OkObjectResult>(await controller.AddComponentSlot(f.Id, new() { CommandId = add.CommandId, DefinitionId = f.Definition,
            SlotId = slot, Name = "Body", ContainerNodeId = f.Child }, default));
        var accepted = await f.Handler.HandleAsync(add, new("owner"));
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await f.Handler.HandleAsync(add with { Slot = add.Slot with { Name = "ignored" } }, new("owner")));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Slots);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Anchor, content, "test"), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), content, descendant, "test"), new("editor"))).Accepted);
        var assign = new SetComponentSlotContentCommand(f.Id, Guid.NewGuid(), f.Anchor, slot, [content]);
        Assert.IsType<OkObjectResult>(await controller.SetComponentSlotContent(f.Id, new() { CommandId = assign.CommandId, NodeId = f.Anchor,
            SlotId = slot, ContentNodeIds = [content] }, default));
        var assigned = await f.Handler.HandleAsync(assign, new("owner"));
        Assert.True(assigned.Accepted);
        Assert.Equal(assigned, await f.Handler.HandleAsync(assign with { ContentNodeIds = [] }, new("owner")));
        var doc = (await f.Journal.ReadAsync(f.Id))!.Document;
        var resolved = ComponentOperations.Resolve(new(doc, doc.ComponentDefinitions, doc.ComponentInstances, doc.Tokens, []), f.Anchor, new Profile());
        Assert.Contains(content, resolved.Nodes.Single(n => n.Id == f.Child).ChildIds);
        Assert.Contains(resolved.Nodes, n => n.Id == descendant);
        Assert.True((await f.Handler.HandleAsync(assign with { CommandId = Guid.NewGuid(), ContentNodeIds = [] }, new("owner"))).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().SlotContent);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new[] { content }, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().SlotContent[slot]);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(assign with { CommandId = Guid.NewGuid() }, new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        for (var i = 0; i < 33; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        var events = (await new DocumentReconnectReader(new Authorization(), f.Journal)
            .ReadAsync(f.Id, 0, new("owner"))).Events!;
        Assert.IsType<ComponentSlotAdded>(events[0].Payload);
        Assert.Contains(events, e => e.Type == "SET_COMPONENT_SLOT_CONTENT" && ((ComponentSlotContentSet)e.Payload).ContentNodeIds.SequenceEqual(new[] { content }));
        var state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Equal(new[] { content }, state.Document.ComponentInstances.Single().SlotContent[slot]);
        Assert.True((await f.Handler.HandleAsync(new DetachComponentInstanceCommand(f.Id, Guid.NewGuid(), f.Anchor, state.Revision), new("owner"))).Accepted);
        doc = (await f.Journal.ReadAsync(f.Id))!.Document;
        Assert.Empty(doc.ComponentInstances);
        Assert.Single(doc.Nodes, n => n.ChildIds.Contains(content));
        Assert.Equal(new[] { descendant }, doc.Nodes.Single(n => n.Id == content).ChildIds);
        Assert.Empty(DocumentStructureValidator.Validate(doc, new Profile()));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new[] { content }, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().SlotContent[slot]);
    }

    [Fact]
    public async Task SlotOwnershipReferencesUniquenessAuthorizationAndProfileAreValidated()
    {
        using var f = new Fixture(); await f.Initialize();
        var slot = Guid.NewGuid();
        var add = new AddComponentSlotCommand(f.Id, Guid.NewGuid(), f.Definition, new(slot, "Body", f.Child));
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] { add with { DefinitionId = Guid.NewGuid() }, add with { Slot = add.Slot with { Id = f.Id } },
            add with { Slot = add.Slot with { ContainerNodeId = f.Anchor } }, add with { Slot = add.Slot with { ContainerNodeId = Guid.NewGuid() } },
            add with { Slot = add.Slot with { Name = "bad\nname" } } })
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(add, new("viewer"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        Assert.True((await f.Handler.HandleAsync(add, new("owner"))).Accepted);
        Assert.False((await f.Handler.HandleAsync(add with { CommandId = Guid.NewGuid(), Slot = add.Slot with { Id = Guid.NewGuid() } }, new("owner"))).Accepted);
        var other = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(add with { CommandId = Guid.NewGuid(), Slot = new(other, "Outer", f.Root) }, new("owner"))).Accepted);
        var content = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Anchor, content, "test"), new("editor"))).Accepted);
        var assign = new SetComponentSlotContentCommand(f.Id, Guid.NewGuid(), f.Anchor, slot, [content]);
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] { assign with { SlotId = Guid.NewGuid() }, assign with { ContentNodeIds = [f.Child] },
            assign with { ContentNodeIds = [Guid.NewGuid()] }, assign with { ContentNodeIds = [content, content] }, assign with { NodeId = f.Root } })
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(assign, new("viewer"))).Code);
        var restricted = new DocumentCommandHandler(new Authorization(), f.Journal, new UnverifiedNodeProfile());
        Assert.False((await restricted.HandleAsync(assign with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        Assert.True((await f.Handler.HandleAsync(assign, new("owner"))).Accepted);
        Assert.False((await f.Handler.HandleAsync(assign with { CommandId = Guid.NewGuid(), SlotId = other }, new("editor"))).Accepted);
        // A component cannot depend on itself through content in its definition subtree.
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("CYCLE_NOT_ALLOWED", (await f.Handler.HandleAsync(new InsertComponentInstanceCommand(f.Id, Guid.NewGuid(), Guid.NewGuid(), f.Definition, f.Child, 0), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task DetachmentMaterializesNestedSlotInstancesAndPreservesAssignedOrderAndUnassignedChildren()
    {
        using var f = new Fixture(); await f.Initialize();
        var slot = Guid.NewGuid(); var nested = Guid.NewGuid(); var first = Guid.NewGuid(); var unassigned = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddComponentSlotCommand(f.Id, Guid.NewGuid(), f.Definition,
            new(slot, "Body", f.Child)), new("owner"))).Accepted);
        foreach (var id in new[] { first, unassigned })
            Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Anchor, id, "test"), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new InsertComponentInstanceCommand(f.Id, Guid.NewGuid(), nested,
            f.Definition, f.Anchor, 0), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new SetComponentSlotContentCommand(f.Id, Guid.NewGuid(), f.Anchor,
            slot, [first, nested]), new("owner"))).Accepted);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.True((await f.Handler.HandleAsync(new DetachComponentInstanceCommand(f.Id, Guid.NewGuid(),
            f.Anchor, state.Revision), new("owner"))).Accepted);
        var doc = (await f.Journal.ReadAsync(f.Id))!.Document;
        Assert.Empty(doc.ComponentInstances);
        var anchor = doc.Nodes.Single(n => n.Id == f.Anchor);
        Assert.Equal(unassigned, anchor.ChildIds[1]);
        var container = doc.Nodes.Single(n => n.Id == anchor.ChildIds[0]);
        Assert.Equal(new[] { first, nested }, container.ChildIds);
        var nestedAnchor = doc.Nodes.Single(n => n.Id == nested);
        Assert.Single(nestedAnchor.ChildIds);
        Assert.Equal("base",
            Assert.IsType<NodeStringValue>(doc.Nodes.Single(n => n.Id == nestedAnchor.ChildIds[0]).Properties["text"]).Value);
        Assert.Empty(DocumentStructureValidator.Validate(doc, new Profile()));
    }

    [Fact]
    public async Task SlotHttpSchemasOpenApiAuthenticationAndRefusals()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-slot-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid(); Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var commands = new (string Route, string Schema, object Payload, string Code)[] {
                ("add-component-slot", "AddComponentSlotRequest", new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), slotId = Guid.NewGuid(), name = "Body", containerNodeId = Guid.NewGuid() }, "COMPONENT_NOT_FOUND"),
                ("set-component-slot-content", "SetComponentSlotContentRequest", new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), slotId = Guid.NewGuid(), contentNodeIds = Array.Empty<Guid>() }, "NODE_NOT_FOUND") };
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            foreach (var item in commands)
            {
                var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{item.Schema}.json")).RootElement.Clone());
                Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(item.Payload)!).IsValid);
                Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
                Assert.Contains(item.Route, await client.GetStringAsync("/openapi/v1.json"));
                var route = $"/api/v1/documents/{id}/commands/{item.Route}";
                var response = await client.PostAsJsonAsync(route, item.Payload);
                Assert.Equal(404, (int)response.StatusCode); Assert.Equal(item.Code, (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
                Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, item.Payload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = null;
                Assert.Equal(401, (int)(await client.PostAsJsonAsync(route, item.Payload)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            }
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new VisualNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
