using System.Security.Claims;
using System.Security.Cryptography;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FigVam.Domain.Tokens;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Server.Documents;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Tests;

public sealed partial class ComponentParameterCommandTests
{
    [Fact]
    public async Task VariantParameterEditsInheritPreserveOverridesAndRecoverWithSafeHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var initial = (await f.Journal.ReadAsync(f.Id))!.Document;
        var derived = Guid.NewGuid();
        Assert.True((await f.Handler.HandleAsync(new AddComponentVariantCommand(f.Id, Guid.NewGuid(), f.Definition,
            new(derived, "Derived", ComponentVariantKind.Custom, f.VariantId, new Dictionary<Guid, ComponentValue>())), new("editor"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new SetComponentInstanceVariantCommand(f.Id, Guid.NewGuid(), f.Anchor, derived), new("editor"))).Accepted);
        var command = new SetComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, f.VariantId, f.ExistingParameter, new ComponentText("updated"));
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        Assert.IsType<OkObjectResult>(await controller.SetComponentVariantParameterChange(f.Id, new() { CommandId = command.CommandId, DefinitionId = f.Definition, VariantId = f.VariantId, ParameterId = f.ExistingParameter, Value = command.Value }, default));
        var accepted = await f.Handler.HandleAsync(command, new("owner"));
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await f.Handler.HandleAsync(command with { Value = null!, VariantId = Guid.Empty }, new("owner")));
        async Task<ComponentValue> Resolve(bool overrides)
        {
            var d = (await f.Journal.ReadAsync(f.Id))!.Document;
            var instances = overrides ? d.ComponentInstances : [d.ComponentInstances.Single() with { ParameterOverrides = new Dictionary<Guid, ComponentValue>() }];
            return ComponentOperations.Resolve(new(d, d.ComponentDefinitions, instances, d.Tokens, []), f.Anchor, new Profile()).Parameters[f.ExistingParameter];
        }
        Assert.Equal(new ComponentText("override"), await Resolve(true));
        Assert.Equal(new ComponentText("updated"), await Resolve(false));
        Assert.Equal(JsonSerializer.Serialize(initial.Nodes), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document.Nodes));
        var reconnect = await new DocumentReconnectReader(new Authorization(), f.Journal).ReadAsync(f.Id, 2, new("owner"));
        Assert.Equal("SET_COMPONENT_VARIANT_PARAMETER_CHANGE", Assert.Single(reconnect.Events!).Type);
        Assert.Equal(command.Value, Assert.IsType<ComponentVariantParameterChangeSet>(reconnect.Events![0].Payload).Value);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("variant"), await Resolve(false));
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("updated"), await Resolve(false));
        var remove = new RemoveComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, f.VariantId, f.ExistingParameter);
        Assert.IsType<OkObjectResult>(await controller.RemoveComponentVariantParameterChange(f.Id, new() { CommandId = remove.CommandId, DefinitionId = f.Definition, VariantId = f.VariantId, ParameterId = f.ExistingParameter }, default));
        Assert.Equal(new ComponentText("base"), await Resolve(false));
        var removed = await f.Handler.HandleAsync(remove, new("owner"));
        Assert.Equal(removed, await f.Handler.HandleAsync(remove with { VariantId = Guid.Empty }, new("owner")));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("updated"), await Resolve(false));
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("base"), await Resolve(false));
        Assert.True((await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), Value = new ComponentText("foreign") }, new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        Assert.Contains((await f.Journal.ReadEventsAsync(f.Id, 0)).Events!, e => e.Type == "REMOVE_COMPONENT_VARIANT_PARAMETER_CHANGE");
        Assert.True((await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), VariantId = derived, Value = new ComponentText("child") }, new("editor"))).Accepted);
        Assert.Equal(new ComponentText("child"), await Resolve(false));
        Assert.True((await f.Handler.HandleAsync(remove with { CommandId = Guid.NewGuid(), VariantId = derived }, new("editor"))).Accepted);
        Assert.Equal(new ComponentText("foreign"), await Resolve(false));
        for (var i = 0; i < 33; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.Equal(new ComponentText("foreign"), await Resolve(false));
        Assert.Equal(new ComponentText("override"), await Resolve(true));
    }

    [Fact]
    public async Task InvalidVariantParameterChangesAreAtomic()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = new SetComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, f.VariantId, f.ExistingParameter, new ComponentText("new"));
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] { command with { DefinitionId = Guid.NewGuid() }, command with { VariantId = Guid.NewGuid() }, command with { ParameterId = Guid.NewGuid() }, command with { Value = new ComponentNumber(double.NaN) }, command with { Value = new ComponentToken(Guid.NewGuid()) }, command with { Value = null! } })
        {
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(new RemoveComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, f.VariantId, f.ExistingParameter), new("viewer"))).Code);
        Assert.False((await f.Handler.HandleAsync(new RemoveComponentVariantParameterChangeCommand(f.Id, Guid.NewGuid(), f.Definition, Guid.NewGuid(), f.ExistingParameter), new("owner"))).Accepted);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        var parameter = new AddComponentParameterCommand(f.Id, Guid.NewGuid(), f.Definition, new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(f.TokenId), TokenType.Color), f.Child, "token");
        Assert.True((await f.Handler.HandleAsync(parameter, new("owner"))).Accepted);
        before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), ParameterId = parameter.Parameter.Id, Value = new ComponentToken(Guid.NewGuid()) }, new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task VariantParameterHttpContractPublishesSchemaAndEnforcesAuthorization()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-default-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid(); Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var payload = new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), variantId = Guid.NewGuid(), parameterId = Guid.NewGuid(), value = new { valueType = "text", value = "text" } };
            var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/SetComponentVariantParameterChangeRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var removalSchema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/RemoveComponentVariantParameterChangeRequest.json")).RootElement.Clone());
            var removal = JsonSerializer.SerializeToNode(payload)!.AsObject(); removal.Remove("value");
            Assert.True(removalSchema.EvaluateNode(removal).IsValid);
            Assert.False(removalSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var route = $"/api/v1/documents/{id}/commands/set-component-variant-parameter-change";
            var response = await client.PostAsJsonAsync(route, payload);
            Assert.Equal(404, (int)response.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            var removeRoute = $"/api/v1/documents/{id}/commands/remove-component-variant-parameter-change";
            var removeResponse = await client.PostAsJsonAsync(removeRoute, removal);
            Assert.Equal(404, (int)removeResponse.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await removeResponse.Content.ReadFromJsonAsync<ApiError>())!.Code);
            var openapi = await client.GetStringAsync("/openapi/v1.json");
            Assert.Contains("set-component-variant-parameter-change", openapi);
            Assert.Contains("remove-component-variant-parameter-change", openapi);
            var malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["actorId"] = "other";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(removeRoute, removal)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(removeRoute, removal)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new UnverifiedNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
