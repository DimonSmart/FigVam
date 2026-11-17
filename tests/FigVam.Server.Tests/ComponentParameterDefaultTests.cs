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
    public async Task DefaultChangeHonorsPrioritiesAndIsDurableIdempotentAndUndoable()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = new SetComponentParameterDefaultCommand(f.Id, Guid.NewGuid(), f.Definition, f.ExistingParameter, new ComponentText("new"));
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        Assert.IsType<OkObjectResult>(await controller.SetComponentParameterDefault(f.Id, new() { CommandId = command.CommandId, DefinitionId = command.DefinitionId, ParameterId = command.ParameterId, Value = command.Value }, default));
        var result = await f.Handler.HandleAsync(command, new("owner"));
        Assert.Equal(result, await f.Handler.HandleAsync(command with { Value = new ComponentText("ignored") }, new("owner")));
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, []);
        Assert.Equal(new ComponentText("override"), ComponentOperations.Resolve(model, f.Anchor, new Profile()).Parameters[f.ExistingParameter]);
        model = model with { Instances = [model.Instances[0] with { ParameterOverrides = new Dictionary<Guid, ComponentValue>() }] };
        Assert.Equal(new ComponentText("variant"), ComponentOperations.Resolve(model, f.Anchor, new Profile()).Parameters[f.ExistingParameter]);
        model = model with { Instances = [model.Instances[0] with { VariantId = null }] };
        Assert.Equal(new ComponentText("new"), ComponentOperations.Resolve(model, f.Anchor, new Profile()).Parameters[f.ExistingParameter]);
        var ev = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, 0)).Events!);
        Assert.Equal("SET_COMPONENT_PARAMETER_DEFAULT", ev.Type);
        Assert.Equal(command.Value, Assert.IsType<ComponentParameterDefaultSet>(ev.Payload).Value);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("base"), (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Parameters.Single().DefaultValue);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentText("new"), (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Parameters.Single().DefaultValue);
        Assert.True((await f.Handler.HandleAsync(command with { CommandId = Guid.NewGuid(), Value = new ComponentText("foreign") }, new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task InvalidDefaultsAndUnauthorizedRequestsAreAtomic()
    {
        using var f = new Fixture(); await f.Initialize();
        var number = f.Command() with { Property = "number", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Number, new ComponentNumber(1)) };
        Assert.True((await f.Handler.HandleAsync(number, new("editor"))).Accepted);
        var command = new SetComponentParameterDefaultCommand(f.Id, Guid.NewGuid(), f.Definition, number.Parameter.Id, new ComponentNumber(2));
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] { command with { DefinitionId = Guid.NewGuid() }, command with { ParameterId = Guid.NewGuid() },
            command with { Value = new ComponentText("wrong") }, command with { Value = new ComponentNumber(-1) },
            command with { Value = new ComponentNumber(double.NaN) }, command with { Value = new ComponentToken(Guid.NewGuid()) } })
        {
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task ReferenceDefaultsAreValidated()
    {
        using var f = new Fixture(); await f.Initialize();
        var parameter = f.Command() with { Property = "token", Parameter = new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(f.TokenId), TokenType.Color) };
        Assert.True((await f.Handler.HandleAsync(parameter, new("owner"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        var bad = new SetComponentParameterDefaultCommand(f.Id, Guid.NewGuid(), f.Definition, parameter.Parameter.Id, new ComponentToken(Guid.NewGuid()));
        Assert.Equal("INVALID_COMPONENT", (await f.Handler.HandleAsync(bad, new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task DefaultHttpContractPublishesSchemaAndEnforcesAuthorization()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-default-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid(); Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var payload = new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), parameterId = Guid.NewGuid(), value = new { valueType = "text", value = "text" } };
            var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/SetComponentParameterDefaultRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var route = $"/api/v1/documents/{id}/commands/set-component-parameter-default";
            var response = await client.PostAsJsonAsync(route, payload);
            Assert.Equal(404, (int)response.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Contains("set-component-parameter-default", await client.GetStringAsync("/openapi/v1.json"));
            var malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["actorId"] = "other";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new UnverifiedNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
