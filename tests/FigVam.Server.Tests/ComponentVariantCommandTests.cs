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
    public async Task VariantCreationSelectionInheritanceHistoryReplayAndVersions()
    {
        using var f = new Fixture(); await f.Initialize();
        var baseline = Guid.NewGuid(); var custom = Guid.NewGuid();
        var add = new AddComponentVariantCommand(f.Id, Guid.NewGuid(), f.Definition,
            new(baseline, "Default", ComponentVariantKind.Default, null,
                new Dictionary<Guid, ComponentValue> { [f.ExistingParameter] = new ComponentText("default variant") }));
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        Assert.IsType<OkObjectResult>(await controller.AddComponentVariant(f.Id, new() { CommandId = add.CommandId,
            DefinitionId = f.Definition, VariantId = baseline, Name = add.Variant.Name, Kind = add.Variant.Kind,
            ParameterChanges = add.Variant.ParameterChanges }, default));
        var accepted = await f.Handler.HandleAsync(add, new("owner"));
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await f.Handler.HandleAsync(add with { Variant = add.Variant with { Name = "ignored" } }, new("owner")));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.DoesNotContain((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Variants, v => v.Id == baseline);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        foreach (var kind in new[] { ComponentVariantKind.Disabled, ComponentVariantKind.Selected, ComponentVariantKind.Custom })
        {
            var variant = new ComponentVariant(kind == ComponentVariantKind.Custom ? custom : Guid.NewGuid(), kind.ToString(), kind, baseline, new Dictionary<Guid, ComponentValue>());
            Assert.True((await f.Handler.HandleAsync(add with { CommandId = Guid.NewGuid(), Variant = variant }, new("editor"))).Accepted);
        }
        var select = new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, custom);
        Assert.IsType<OkObjectResult>(await controller.SetComponentInstanceVariant(f.Id, new() { CommandId = select.CommandId, NodeId = f.Anchor, VariantId = custom }, default));
        var selected = await f.Handler.HandleAsync(select, new("owner"));
        Assert.Equal(selected, await f.Handler.HandleAsync(select with { VariantId = null }, new("owner")));
        async Task<ComponentValue> Resolve()
        {
            var document = (await f.Journal.ReadAsync(f.Id))!.Document;
            return ComponentOperations.Resolve(new(document, document.ComponentDefinitions, document.ComponentInstances, document.Tokens, []), f.Anchor, new Profile()).Parameters[f.ExistingParameter];
        }
        Assert.Equal(new ComponentText("override"), await Resolve());
        Assert.True((await f.Handler.HandleAsync(new RemoveComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, f.ExistingParameter), new("editor"))).Accepted);
        Assert.Equal(new ComponentText("default variant"), await Resolve());
        var saved = await f.Handler.HandleAsync(new SaveDocumentCommand(f.Id, Guid.NewGuid(), "Variants"), new("owner"));
        var immutable = JsonSerializer.Serialize((await f.Journal.ReadVersionAsync(f.Id, saved.VersionId!.Value)).Version);
        Assert.True((await f.Handler.HandleAsync(select with { CommandId = Guid.NewGuid(), VariantId = null }, new("owner"))).Accepted);
        Assert.Equal(new ComponentText("base"), await Resolve());
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(custom, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().VariantId);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Null((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().VariantId);
        Assert.True((await f.Handler.HandleAsync(new RestoreDocumentVersionCommand(f.Id, Guid.NewGuid(), saved.VersionId.Value), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("default variant"), await Resolve());
        Assert.Equal(immutable, JsonSerializer.Serialize((await f.Journal.ReadVersionAsync(f.Id, saved.VersionId.Value)).Version));
        var events = (await f.Journal.ReadEventsAsync(f.Id, 0)).Events!;
        Assert.IsType<ComponentVariantAdded>(events[0].Payload);
        Assert.Contains(events, e => e.Type == "SET_COMPONENT_INSTANCE_VARIANT" && ((ComponentInstanceVariantSet)e.Payload).VariantId == custom);
        for (var i = 0; i < 33; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.Equal(new ComponentText("default variant"), await Resolve());
        Assert.Equal(accepted, await f.Handler.HandleAsync(add, new("owner")));
    }

    [Fact]
    public async Task VariantValidationAuthorizationAndUnsafeHistoryPreserveState()
    {
        using var f = new Fixture(); await f.Initialize();
        var id = Guid.NewGuid();
        var add = new AddComponentVariantCommand(f.Id, Guid.NewGuid(), f.Definition,
            new(id, "Custom", ComponentVariantKind.Custom, f.VariantId, new Dictionary<Guid, ComponentValue>()));
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] {
            add with { DefinitionId = Guid.NewGuid() }, add with { Variant = add.Variant with { Id = f.Id } },
            add with { Variant = add.Variant with { BaseVariantId = id } },
            add with { Variant = add.Variant with { BaseVariantId = Guid.NewGuid() } },
            add with { Variant = add.Variant with { Kind = ComponentVariantKind.Hover } },
            add with { Variant = add.Variant with { Kind = (ComponentVariantKind)999 } },
            add with { Variant = add.Variant with { Name = "bad\nname" } },
            add with { Variant = add.Variant with { ParameterChanges = new Dictionary<Guid, ComponentValue> { [Guid.NewGuid()] = new ComponentText("x") } } },
            add with { Variant = add.Variant with { ParameterChanges = new Dictionary<Guid, ComponentValue> { [f.ExistingParameter] = new ComponentBool(true) } } } })
        {
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(add, new("viewer"))).Code);
        foreach (var bad in new[] { new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, Guid.NewGuid()),
            new(f.Id, Guid.NewGuid(), f.Root, f.VariantId), new(f.Id, Guid.NewGuid(), Guid.NewGuid(), null) })
        {
            Assert.False((await f.Handler.HandleAsync(bad, new("owner"))).Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, null), new("viewer"))).Code);
        Assert.True((await f.Handler.HandleAsync(add, new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, id), new("editor"))).Accepted);
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        Assert.True((await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, null), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, f.VariantId), new("editor"))).Accepted);
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task ForeignVariantBasesParametersAndSelectionsAreRejected()
    {
        using var f = new Fixture(); await f.Initialize();
        var foreign = Guid.NewGuid(); var variant = Guid.NewGuid(); var parameter = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddComponentDefinitionCommand(f.Id, Guid.NewGuid(), foreign, "Other", "", f.Root), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentParameterCommand(f.Id, Guid.NewGuid(), foreign,
            new(parameter, "Text", ComponentParameterType.Text, new ComponentText("foreign")), f.Child, "text"), new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new AddComponentVariantCommand(f.Id, Guid.NewGuid(), foreign,
            new(variant, "Foreign", ComponentVariantKind.Custom, null, new Dictionary<Guid, ComponentValue>())), new("owner"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var v in new[] { new ComponentVariant(Guid.NewGuid(), "Bad", ComponentVariantKind.Custom, variant, new Dictionary<Guid, ComponentValue>()),
            new(Guid.NewGuid(), "Bad", ComponentVariantKind.Custom, null, new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("x") }) })
            Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new AddComponentVariantCommand(f.Id, Guid.NewGuid(), f.Definition, v), new("owner"))).Code);
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, variant), new("owner"))).Code);
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new SetComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, variant, f.ExistingParameter, new ComponentText("x")), new("owner"))).Code);
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(new SetComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, f.VariantId, parameter, new ComponentText("x")), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task VariantHttpContractPublishesSchemasAndRefusals()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-variant-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid(); Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var payload = new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), variantId = Guid.NewGuid(), name = "Hover", kind = 1,
                parameterChanges = new Dictionary<Guid, object> { [Guid.NewGuid()] = new { valueType = "text", value = "hover" } } };
            var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddComponentVariantRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var route = $"/api/v1/documents/{id}/commands/add-component-variant";
            var response = await client.PostAsJsonAsync(route, payload); Assert.Equal(404, (int)response.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            var selection = new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), variantId = (Guid?)null };
            schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/SetComponentInstanceVariantRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(selection)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            response = await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/set-component-instance-variant", selection);
            Assert.Equal("NODE_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            var openapi = await client.GetStringAsync("/openapi/v1.json"); Assert.Contains("add-component-variant", openapi); Assert.Contains("set-component-instance-variant", openapi);
            var malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["actorId"] = "other";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null; Assert.Equal(401, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new VisualNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
