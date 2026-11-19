using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed partial class ComponentParameterCommandTests
{
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => kind == "test";
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch
        {
            "text" => new(NodePropertyType.String),
            "number" => new(NodePropertyType.Number, v => ((NodeNumberValue)v).Value >= 0 ? null : "Requires a nonnegative number."),
            "bool" => new(NodePropertyType.Boolean),
            "token" => new(NodePropertyType.TokenReference, TokenType: TokenType.Color),
            "enum" => new(NodePropertyType.Enum, EnumValues: ["Small", "Large"]),
            "asset" => new(NodePropertyType.Asset),
            _ => null
        };
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken ct) => new(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken ct) => new(actor.Id is "owner" or "editor");
    }
    private sealed class Fixture : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-parameter-" + Guid.NewGuid());
        public Guid Id { get; } = Guid.NewGuid();
        public Guid Root { get; } = Guid.NewGuid();
        public Guid Child { get; } = Guid.NewGuid();
        public Guid Anchor { get; } = Guid.NewGuid();
        public Guid Definition { get; } = Guid.NewGuid();
        public Guid ExistingParameter { get; } = Guid.NewGuid();
        public Guid TokenId { get; } = Guid.NewGuid();
        public Guid VariantId { get; } = Guid.NewGuid();
        public SqliteDocumentJournal Journal => new(directory, new Profile());
        public DocumentCommandHandler Handler => new(new Authorization(), Journal, new Profile());
        public async Task Initialize()
        {
            var screen = Guid.NewGuid();
            var document = new DocumentStructure(Id, [new(Guid.NewGuid(), [screen])], [new(screen, [Root, Anchor], new(800, 600))],
                [new(Root, "test", [Child]), new(Child, "test", []), new(Anchor, "test", [])])
            {
                Tokens = [new(TokenId, "Color", TokenType.Color, new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = new LiteralTokenValue(new ColorValue(1, 2, 3)), [TokenTheme.Dark] = new LiteralTokenValue(new ColorValue(4, 5, 6)) })],
                ComponentDefinitions = [new(Definition, "Card", "", Root,
                    [new(ExistingParameter, "Text", ComponentParameterType.Text, new ComponentText("base"))], [], [new(VariantId, "Hover", ComponentVariantKind.Hover, null, new Dictionary<Guid, ComponentValue> { [ExistingParameter] = new ComponentText("variant") })])
                    { Bindings = [new(ExistingParameter, Child, "text")] }],
                ComponentInstances = [new(Anchor, Definition, VariantId,
                    new Dictionary<Guid, ComponentValue> { [ExistingParameter] = new ComponentText("override") },
                    new Dictionary<Guid, IReadOnlyList<Guid>>())]
            };
            await Journal.InitializeAsync(document);
        }
        public AddComponentParameterCommand Command() => new(Id, Guid.NewGuid(), Definition,
            new(Guid.NewGuid(), "Enabled", ComponentParameterType.Bool, new ComponentBool(true)), Child, "bool");
        public void Dispose() => Directory.Delete(directory, true);
    }

    [Fact]
    public async Task OverridesAreValidatedDurableIdempotentAndSafeInHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var removeText = new RemoveComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, f.ExistingParameter);
        Assert.True((await f.Handler.HandleAsync(removeText, new("owner"))).Accepted);
        var inherited = (await f.Journal.ReadAsync(f.Id))!.Document;
        Assert.Equal(new ComponentText("variant"), ComponentOperations.Resolve(new(inherited, inherited.ComponentDefinitions, inherited.ComponentInstances, inherited.Tokens, []), f.Anchor, new Profile()).Parameters[f.ExistingParameter]);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        var parameter = f.Command();
        Assert.True((await f.Handler.HandleAsync(parameter, new("editor"))).Accepted);
        var set = new SetComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, parameter.Parameter.Id, new ComponentBool(false));
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var response = Assert.IsType<OkObjectResult>(await controller.SetComponentParameterOverride(f.Id, new()
            { CommandId = set.CommandId, NodeId = set.NodeId, ParameterId = set.ParameterId, Value = set.Value }, default));
        Assert.Contains(set.ParameterId, Assert.IsType<CommandResponse>(response.Value).AffectedIds);
        var result = await f.Handler.HandleAsync(set, new("owner"));
        Assert.Equal(result, await f.Handler.HandleAsync(set with { Value = new ComponentBool(true) }, new("owner")));
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var overrides = state.Document.ComponentInstances.Single().ParameterOverrides;
        Assert.Equal(new ComponentBool(false), overrides[parameter.Parameter.Id]);
        Assert.Equal(new ComponentText("override"), overrides[f.ExistingParameter]);
        var committed = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, result.Revision!.Value - 1)).Events!);
        Assert.Equal("SET_COMPONENT_PARAMETER_OVERRIDE", committed.Type);
        Assert.Equal(new ComponentBool(false), Assert.IsType<ComponentParameterOverrideSet>(committed.Payload).Value);
        Assert.True((await f.Handler.HandleAsync(set with { CommandId = Guid.NewGuid(), Value = new ComponentBool(true) }, new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(new RemoveComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, parameter.Parameter.Id), new("owner"))).Accepted);
        state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.False(state.Document.ComponentInstances.Single().ParameterOverrides.ContainsKey(parameter.Parameter.Id));
        var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, []);
        Assert.Equal(new ComponentBool(true), ComponentOperations.Resolve(model, f.Anchor, new Profile()).Parameters[parameter.Parameter.Id]);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(new ComponentBool(true), (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().ParameterOverrides[parameter.Parameter.Id]);
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.False((await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().ParameterOverrides.ContainsKey(parameter.Parameter.Id));
        Assert.True((await f.Handler.HandleAsync(set with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
        Assert.True((await f.Handler.HandleAsync(set with { CommandId = Guid.NewGuid(), Value = new ComponentBool(true) }, new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        for (var i = 0; i < 32; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.Equal(new ComponentBool(true), (await f.Journal.ReadAsync(f.Id))!.Document.ComponentInstances.Single().ParameterOverrides[parameter.Parameter.Id]);
    }

    [Fact]
    public async Task InvalidOverridesAndUnauthorizedRequestsLeaveRevisionUnchanged()
    {
        using var f = new Fixture(); await f.Initialize();
        var number = f.Command() with { Property = "number", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Number, new ComponentNumber(1)) };
        Assert.True((await f.Handler.HandleAsync(number, new("editor"))).Accepted);
        var command = new SetComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, number.Parameter.Id, new ComponentNumber(2));
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        foreach (var bad in new[] { command with { NodeId = Guid.NewGuid() }, command with { NodeId = f.Root },
            command with { ParameterId = Guid.NewGuid() }, command with { Value = new ComponentText("wrong") },
            command with { Value = new ComponentNumber(-1) }, command with { Value = new ComponentNumber(double.NaN) },
            command with { NodeId = Guid.Empty } })
        {
            Assert.False((await f.Handler.HandleAsync(bad with { CommandId = Guid.NewGuid() }, new("owner"))).Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new("viewer"))).Code);
        Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(new RemoveComponentParameterOverrideCommand(f.Id, Guid.NewGuid(), f.Anchor, number.Parameter.Id), new("outsider"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    [Fact]
    public async Task AdditionResolvesInstancesPreservesOverridesAndSurvivesReplaySnapshotsAndHistory()
    {
        using var f = new Fixture(); await f.Initialize();
        var before = (await f.Journal.ReadAsync(f.Id))!;
        var command = f.Command();
        var controller = new DocumentCommandController(f.Handler) { ControllerContext = new() { HttpContext = new DefaultHttpContext
            { User = new(new ClaimsIdentity([new Claim("sub", "owner")], "test")) } } };
        var response = Assert.IsType<OkObjectResult>(await controller.AddComponentParameter(f.Id, new()
        {
            CommandId = command.CommandId, DefinitionId = command.DefinitionId, ParameterId = command.Parameter.Id,
            Name = command.Parameter.Name, Type = command.Parameter.Type, DefaultValue = command.Parameter.DefaultValue,
            NodeId = command.NodeId, Property = command.Property
        }, default));
        Assert.Contains(command.Parameter.Id, Assert.IsType<CommandResponse>(response.Value).AffectedIds);
        var result = await f.Handler.HandleAsync(command, new("owner"));
        Assert.True(result.Accepted); Assert.Equal(1, result.Revision);
        Assert.Contains(command.Parameter.Id, result.AffectedIds!);
        Assert.Equal(result, await f.Handler.HandleAsync(command with { Property = "ignored" }, new("owner")));
        var state = (await f.Journal.ReadAsync(f.Id))!;
        var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, []);
        var resolved = ComponentOperations.Resolve(model, f.Anchor, new Profile());
        var child = resolved.Nodes.Single(n => n.Id == f.Child);
        Assert.Equal(new NodeBooleanValue(true), child.Properties["bool"]);
        Assert.Equal(new NodeStringValue("override"), child.Properties["text"]);
        Assert.Equal(JsonSerializer.Serialize(before.Document.ComponentInstances), JsonSerializer.Serialize(state.Document.ComponentInstances));
        var committed = Assert.Single((await f.Journal.ReadEventsAsync(f.Id, 0)).Events!);
        Assert.Equal("ADD_COMPONENT_PARAMETER", committed.Type);
        Assert.Equal(command.Parameter.Id, Assert.IsType<ComponentParameterAdded>(committed.Payload).Parameter.Id);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Equal(JsonSerializer.Serialize(before.Document), JsonSerializer.Serialize((await f.Journal.ReadAsync(f.Id))!.Document));
        Assert.True((await f.Handler.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        for (var i = 0; i < 33; i++) Assert.True((await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.Equal(2, (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Parameters.Count);
        Assert.Equal(result, await f.Handler.HandleAsync(command, new("owner")));
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        Assert.Single((await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Parameters);
        Assert.Equal(34, (await f.Journal.ReadAsync(f.Id))!.Document.Pages.Count);
    }

    [Fact]
    public async Task InvalidContractsReferencesOwnershipAndProfileLeaveDocumentAndRevisionUnchanged()
    {
        using var f = new Fixture(); await f.Initialize();
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        var command = f.Command();
        var bad = new[] {
            command with { DefinitionId = Guid.NewGuid() }, command with { NodeId = Guid.NewGuid() },
            command with { NodeId = f.Anchor }, command with { Property = "unknown" },
            command with { Property = "text" }, command with { Parameter = command.Parameter with { Id = f.ExistingParameter } },
            command with { Parameter = command.Parameter with { Id = f.Id } }, command with { Parameter = command.Parameter with { Id = Guid.Empty } },
            command with { Parameter = command.Parameter with { Name = "" } }, command with { Parameter = command.Parameter with { Name = "bad\nname" } },
            command with { Parameter = command.Parameter with { DefaultValue = new ComponentText("wrong") } },
            command with { Parameter = command.Parameter with { TokenType = TokenType.Color } },
            command with { Parameter = command.Parameter with { Type = (ComponentParameterType)999 } },
            command with { Property = "number", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Number, new ComponentNumber(-1)) },
            command with { Property = "token", Parameter = new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(Guid.NewGuid()), TokenType.Color) },
            command with { Property = "token", Parameter = new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(f.TokenId), TokenType.Spacing) },
            command with { Property = "enum", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Enum, new ComponentEnum("Other"), EnumValues: ["Other"]) },
            command with { Property = "enum", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Enum, new ComponentEnum("Small"), EnumValues: ["Small", "Small"]) },
            command with { Property = "asset", Parameter = new(Guid.NewGuid(), "Image", ComponentParameterType.Asset, new ComponentAsset(Guid.NewGuid())) }
        };
        foreach (var item in bad)
        {
            var rejected = await f.Handler.HandleAsync(item with { CommandId = Guid.NewGuid() }, new("owner"));
            Assert.False(rejected.Accepted);
            Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        }
        foreach (var actor in new[] { "viewer", "outsider" })
            Assert.Equal("FORBIDDEN", (await f.Handler.HandleAsync(command, new(actor))).Code);
        Assert.Empty((await f.Journal.ReadEventsAsync(f.Id, 0)).Events!);
    }

    [Fact]
    public async Task TypedMetadataIsDurableAndCompensationCannotEraseAnotherActorsParameter()
    {
        using var f = new Fixture(); await f.Initialize();
        var token = f.Command() with { Property = "token", Parameter = new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(f.TokenId), TokenType.Color) };
        Assert.True((await f.Handler.HandleAsync(token, new("owner"))).Accepted);
        var item = f.Command() with { Property = "enum", Parameter = new(Guid.NewGuid(), "Size", ComponentParameterType.Enum, new ComponentEnum("Small"), EnumValues: ["Small", "Large"]) };
        Assert.True((await f.Handler.HandleAsync(item, new("editor"))).Accepted);
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
        var parameters = (await f.Journal.ReadAsync(f.Id))!.Document.ComponentDefinitions.Single().Parameters;
        Assert.Equal(TokenType.Color, parameters.Single(p => p.Id == token.Parameter.Id).TokenType);
        Assert.Equal(new[] { "Small", "Large" }, parameters.Single(p => p.Id == item.Parameter.Id).EnumValues);
    }

    [Fact]
    public async Task ParameterIdsCannotBeReusedAndRedoRequiresCurrentProfileSupport()
    {
        using var f = new Fixture(); await f.Initialize();
        var command = f.Command();
        Assert.True((await f.Handler.HandleAsync(command, new("owner"))).Accepted);
        var state = (await f.Journal.ReadAsync(f.Id))!;
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddPageCommand(f.Id, Guid.NewGuid(), command.Parameter.Id), new("editor"))).Code);
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddScreenCommand(f.Id, Guid.NewGuid(), state.Document.Pages.Single().Id, command.Parameter.Id, new(800, 600)), new("editor"))).Code);
        Assert.Equal("DUPLICATE_ID", (await f.Handler.HandleAsync(new AddNodeCommand(f.Id, Guid.NewGuid(), f.Root, command.Parameter.Id, "test"), new("editor"))).Code);
        Assert.True((await f.Handler.HandleAsync(new UndoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Accepted);
        var restricted = new DocumentCommandHandler(new Authorization(), f.Journal, new WithoutBooleanProperty());
        var before = JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id));
        Assert.Equal("REDO_NOT_APPLICABLE", (await restricted.HandleAsync(new RedoDocumentCommand(f.Id, Guid.NewGuid()), new("owner"))).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await f.Journal.ReadAsync(f.Id)));
    }

    private sealed class WithoutBooleanProperty : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        private readonly Profile profile = new();
        public bool IsKnownKind(string kind) => profile.IsKnownKind(kind);
        public bool CanContainChildren(string kind) => profile.CanContainChildren(kind);
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "bool" ? null : profile.GetProperty(kind, property);
    }

    [Fact]
    public async Task PublicHttpContractPublishesTypedValuesAndStructuredRefusals()
    {
        using var key = RSA.Create(2048); var config = Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-parameter-api-" + Guid.NewGuid()); config["Storage__Directory"] = directory;
        try
        {
            await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync();
            using var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
            var id = Guid.NewGuid();
            Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
            var overrideRoute = $"/api/v1/documents/{id}/commands/set-component-parameter-override";
            var overridePayload = new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), parameterId = Guid.NewGuid(), value = new { valueType = "text", value = "hello" } };
            var overrideSchema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/SetComponentParameterOverrideRequest.json")).RootElement.Clone());
            Assert.True(overrideSchema.EvaluateNode(JsonSerializer.SerializeToNode(overridePayload)!).IsValid);
            Assert.False(overrideSchema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            var removeSchema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/RemoveComponentParameterOverrideRequest.json")).RootElement.Clone());
            Assert.True(removeSchema.EvaluateNode(JsonSerializer.SerializeToNode(new { commandId = Guid.NewGuid(), nodeId = Guid.NewGuid(), parameterId = Guid.NewGuid() })!).IsValid);
            var overrideResponse = await client.PostAsJsonAsync(overrideRoute, overridePayload);
            Assert.Equal(404, (int)overrideResponse.StatusCode);
            Assert.Equal("NODE_NOT_FOUND", (await overrideResponse.Content.ReadFromJsonAsync<ApiError>())!.Code);
            Assert.Contains("remove-component-parameter-override", await client.GetStringAsync("/openapi/v1.json"));
            var route = $"/api/v1/documents/{id}/commands/add-component-parameter";
            var payload = new { commandId = Guid.NewGuid(), definitionId = Guid.NewGuid(), parameterId = Guid.NewGuid(), name = "Text", type = 0, defaultValue = new { valueType = "text", value = "base" }, nodeId = Guid.NewGuid(), property = "text" };
            var schema = JsonSchema.Build(JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddComponentParameterRequest.json")).RootElement.Clone());
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(payload)!).IsValid);
            Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
            Assert.Contains("add-component-parameter", await client.GetStringAsync("/openapi/v1.json"));
            var missingValue = JsonSerializer.SerializeToNode(payload)!.AsObject(); missingValue["defaultValue"]!.AsObject().Remove("value");
            Assert.False(schema.EvaluateNode(missingValue).IsValid);
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, missingValue)).StatusCode);
            var response = await client.PostAsJsonAsync(route, payload);
            Assert.Equal(404, (int)response.StatusCode);
            Assert.Equal("COMPONENT_NOT_FOUND", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
            var malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["defaultValue"]!["valueType"] = "unknown";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            malformed = JsonSerializer.SerializeToNode(payload)!.AsObject(); malformed["actorId"] = "editor";
            Assert.Equal(400, (int)(await client.PostAsJsonAsync(route, malformed)).StatusCode);
            await client.PutAsJsonAsync($"/api/v1/documents/{id}/members", new { memberId = "viewer", role = "Viewer" });
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
            Assert.Equal(403, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            client.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(401, (int)(await client.PostAsJsonAsync(route, payload)).StatusCode);
            Assert.Equal(0, (await new SqliteDocumentJournal(directory, new UnverifiedNodeProfile()).ReadAsync(id))!.Revision);
        }
        finally { Directory.Delete(directory, true); }
    }
}
