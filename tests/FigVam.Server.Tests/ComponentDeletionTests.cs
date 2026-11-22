using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

public sealed partial class ComponentParameterCommandTests
{
    [Fact]
    public async Task ComponentDeletionRequiresExplicitCompatibleMappingsAndRecoversSafeHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var actor = new DocumentActor("owner");
        var target = Guid.NewGuid(); var root = Guid.NewGuid(); var parameter = Guid.NewGuid(); var variant = Guid.NewGuid();
        var screen = (await f.Journal.ReadAsync(f.Id))!.Document.Screens.Single().Id;
        Assert.True((await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), screen, root, "test"), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentDefinitionCommand(f.Id, Guid.NewGuid(), target, "Replacement", "", root), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentParameterCommand(f.Id, Guid.NewGuid(), target, new(parameter, "Text", ComponentParameterType.Text, new ComponentText("target")), root, "text"), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentVariantCommand(f.Id, Guid.NewGuid(), target, new(variant, "Hover", ComponentVariantKind.Hover, null, new Dictionary<Guid, ComponentValue>())), new("editor"))).Accepted);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var before = JsonSerializer.Serialize(state);
        var command = new DeleteComponentDefinitionCommand(f.Id, Guid.NewGuid(), f.Definition, state.Revision);
        Assert.Equal("COMPONENT_IN_USE", (await f.Handler.HandleAsync(command, actor)).Code);
        var replacement = new ComponentReplacement(target, new Dictionary<Guid, Guid> { [f.ExistingParameter] = parameter }, new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid> { [f.VariantId] = variant });
        foreach (var invalid in new[] {
            replacement with { DefinitionId = f.Definition }, replacement with { DefinitionId = Guid.NewGuid() },
            replacement with { ParameterIds = new Dictionary<Guid, Guid>() }, replacement with { VariantIds = new Dictionary<Guid, Guid>() },
            replacement with { ParameterIds = new Dictionary<Guid, Guid> { [f.ExistingParameter] = Guid.NewGuid() } },
            replacement with { SlotIds = new Dictionary<Guid, Guid> { [Guid.NewGuid()] = Guid.NewGuid() } },
            replacement with { ParameterIds = null! }
        })
        {
            Assert.Equal("INVALID_COMPONENT_REPLACEMENT", (await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), Replacement = invalid }, actor)).Code);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        Assert.Equal("REVISION_CONFLICT", (await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), ExpectedRevision = state.Revision - 1 }, actor)).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        command = command with { CommandId = Guid.NewGuid(), Replacement = replacement };
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        Assert.IsType<OkObjectResult>(await controller.DeleteComponentDefinition(f.Id, new() { CommandId = command.CommandId, DefinitionId = command.DefinitionId, ExpectedRevision = command.ExpectedRevision, Replacement = new() { DefinitionId = target, ParameterIds = replacement.ParameterIds, SlotIds = replacement.SlotIds, VariantIds = replacement.VariantIds } }, default));
        var accepted = await f.Handler.HandleAsync(command, actor);
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await f.Handler.HandleAsync(command with { DefinitionId = Guid.Empty, ExpectedRevision = -1, Replacement = null }, actor));
        var deleted = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Equal(JsonSerializer.Serialize(state.Document.Nodes), JsonSerializer.Serialize(deleted.Document.Nodes));
        Assert.DoesNotContain(deleted.Document.ComponentDefinitions, d => d.Id == f.Definition);
        var instance = Assert.Single(deleted.Document.ComponentInstances);
        Assert.Equal(target, instance.DefinitionId); Assert.Equal(variant, instance.VariantId);
        Assert.Equal(new ComponentText("override"), instance.ParameterOverrides[parameter]);
        var events = await f.Journal.ReadEventsAsync(f.Id, state.Revision);
        Assert.Equal("DELETE_COMPONENT_DEFINITION", Assert.Single(events.Events!).Type);
        Assert.IsType<ComponentDefinitionDeleted>(events.Events![0].Payload);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(state.Document), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document));
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(deleted.Document), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document));
        Assert.True((await f.Handler.HandleAsync(new SetComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, parameter, new ComponentText("foreign")), new("editor"))).Accepted);
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), actor)).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        for (var i = 0; i < 33; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.DoesNotContain((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions, d => d.Id == f.Definition);
    }

    [Fact]
    public async Task ReplacementCannotChangeParameterTypeOrCreateComponentCycle()
    {
        using var f = new Fixture(); await f.Initialize();
        var target = Guid.NewGuid(); var parameter = Guid.NewGuid(); var variant = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddComponentDefinitionCommand(f.Id, Guid.NewGuid(), target, "Target", "", f.Anchor), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentParameterCommand(f.Id, Guid.NewGuid(), target, new(parameter, "Bool", ComponentParameterType.Bool, new ComponentBool(true)), f.Anchor, "bool"), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentVariantCommand(f.Id, Guid.NewGuid(), target, new(variant, "Hover", ComponentVariantKind.Hover, null, new Dictionary<Guid, ComponentValue>())), new("editor"))).Accepted);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var replacement = new ComponentReplacement(target, new Dictionary<Guid, Guid> { [f.ExistingParameter] = parameter }, new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid> { [f.VariantId] = variant });
        var command = new DeleteComponentDefinitionCommand(f.Id, Guid.NewGuid(), f.Definition, state.Revision, replacement);
        Assert.Equal("INVALID_COMPONENT_REPLACEMENT", (await f.Handler.HandleAsync(command, new("owner"))).Code);
        Assert.Equal(JsonSerializer.Serialize(state), JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        parameter = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddComponentParameterCommand(f.Id, Guid.NewGuid(), target, new(parameter, "Text", ComponentParameterType.Text, new ComponentText("target")), f.Anchor, "text"), new("editor"))).Accepted);
        state = (await f.Journal.ReadAsync(f.Id))!;
        command = command with { CommandId = Guid.NewGuid(), ExpectedRevision = state.Revision, Replacement = replacement with { ParameterIds = new Dictionary<Guid, Guid> { [f.ExistingParameter] = parameter } } };
        Assert.Equal("INVALID_COMPONENT_REPLACEMENT", (await f.Handler.HandleAsync(command, new("owner"))).Code);
        Assert.Equal(JsonSerializer.Serialize(state), JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task DetachedDefinitionCanBeDeletedAndUndoRejectsNewForeignUsage()
    {
        using var f = new Fixture(); await f.Initialize(); var actor = new DocumentActor("owner");
        Assert.True((await f.Handler.HandleAsync(new DetachComponentInstanceCommand(f.Id, Guid.NewGuid(), f.Anchor, 0), new("editor"))).Accepted);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var command = new DeleteComponentDefinitionCommand(f.Id, Guid.NewGuid(), f.Definition, state.Revision);
        Assert.True((await f.Handler.HandleAsync(command, actor)).Accepted);
        Assert.Empty((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions);
        Assert.Equal(JsonSerializer.Serialize(state.Document.Nodes), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document.Nodes));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), actor)).Accepted);
        var screen = state.Document.Screens.Single().Id;
        Assert.True((await f.Handler.HandleAsync(new InsertComponentInstanceCommand(f.Id, Guid.NewGuid(), Guid.NewGuid(), f.Definition, screen, 0), new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("REDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), actor)).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task ComponentDeletionHttpContractPublishesSchemaAndStructuredErrors()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-delete-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid(); Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var payload = new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), expectedRevision = 0, replacement = new { definitionId = Guid.NewGuid(), parameterIds = new Dictionary<Guid, Guid>(), slotIds = new Dictionary<Guid, Guid>(), variantIds = new Dictionary<Guid, Guid>() } };
            var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DeleteComponentDefinitionRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["replacement"]!.AsObject().Remove("slotIds");
            Assert.False(schema.EvaluateNode(malformed).IsValid);
            var route = $"/api/v1/documents/{id}/commands/delete-component-definition";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            var response = await client.PostAsJsonAsync(route, payload);
            Assert.Equal(404, (int)response.StatusCode); Assert.Equal("COMPONENT_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Contains("delete-component-definition", await client.GetStringAsync("/openapi/v1.json"));
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new VisualNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
