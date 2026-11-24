using System.Collections.Immutable;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ScreenVariantTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-screen-variants-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), screen = Guid.NewGuid(), other = Guid.NewGuid(), node = Guid.NewGuid(), foreign = Guid.NewGuid(), variant = Guid.NewGuid();
    private readonly DocumentActor actor = new("owner");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch {
            "text" => new(NodePropertyType.String), "number" => new(NodePropertyType.Number, v => ((NodeNumberValue)v).Value >= 0 ? null : "Must be nonnegative."), "token" => new(NodePropertyType.TokenReference, TokenType: TokenType.Spacing), "asset" => new(NodePropertyType.Asset), "choice" => new(NodePropertyType.Enum, EnumValues: ["first", "second"]), _ => null };
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Authorization(), Journal(), new Profile());
    private Task Seed() => Journal().InitializeAsync(new(doc, [], [new(screen, [node], new(800, 600)), new(other, [foreign], new(800, 600))], [new(node, "test", []) { Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("text", new NodeStringValue("base")) }, new(foreign, "test", [])]));
    private AddScreenVariantCommand Add(Guid? id = null) => new(doc, Guid.NewGuid(), screen, id ?? variant, "Alternate");
    private SetScreenVariantOverrideCommand Set(Guid? id = null) => new(doc, Guid.NewGuid(), screen, id ?? variant, node, "text", new NodeStringValue("difference"));

    [Fact]
    public async Task ShadowOverridePreservesBaseAndResetsToInheritedValue()
    {
        var profile = new VisualNodeProfile();
        var journal = new SqliteDocumentJournal(directory, profile);
        var handler = new DocumentCommandHandler(new Authorization(), journal, profile);
        var shadow = new NodeShadowValue(0, 4, 8, 0, new(0, 0, 0, 38));
        var frame = new NodeStructure(node, "Frame", []) { Properties =
            ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("shadow", shadow) };
        await journal.InitializeAsync(new(doc, [], [new(screen, [node], new(800, 600))], [frame]));
        Assert.True((await handler.HandleAsync(Add(), actor)).Accepted);
        var alternate = shadow with { BlurRadius = 32 };
        var result = await handler.HandleAsync(new SetScreenVariantOverrideCommand(doc, Guid.NewGuid(), screen, variant, node, "shadow", alternate), actor);
        Assert.True(result.Accepted, result.Code);
        var state = (await journal.ReadAsync(doc))!;
        Assert.Equal(shadow, Assert.Single(state.Document.Nodes).Properties["shadow"]);
        Assert.Equal(alternate, Assert.Single(Assert.Single(Assert.Single(state.Document.Screens).Variants).Overrides).Value);
        var diff = (await new DocumentScreenVariantDiff(new Authorization(), journal).CompareAsync(doc, screen, null, variant, null, 0, 100, actor)).Response!;
        Assert.Equal("shadow", Assert.Single(diff.Items).Property);
        Assert.True((await handler.HandleAsync(new RemoveScreenVariantOverrideCommand(doc, Guid.NewGuid(), screen, variant, node, "shadow", state.Revision), actor)).Accepted);
        Assert.Empty(Assert.Single(Assert.Single((await journal.ReadAsync(doc))!.Document.Screens).Variants).Overrides);
        Assert.Equal(shadow, Assert.Single((await journal.ReadAsync(doc))!.Document.Nodes).Properties["shadow"]);
    }

    [Fact]
    public async Task BatchInspectorOverridesUseOneRevisionAndPreserveBaseOnConflict()
    {
        await Seed();
        var handler = Handler();
        Assert.True((await handler.HandleAsync(Add(), actor)).Accepted);
        var before = (await Journal().ReadAsync(doc))!;
        var command = new SetScreenVariantPropertiesCommand(doc, Guid.NewGuid(), screen, variant, node,
            new Dictionary<string, NodePropertyValue>
            {
                ["text"] = new NodeStringValue("invalid password"),
                ["number"] = new NodeNumberValue(5)
            }, before.Revision);
        var accepted = await handler.HandleAsync(command, actor);
        Assert.True(accepted.Accepted, accepted.Code);
        Assert.Equal(before.Revision + 1, accepted.Revision);
        Assert.Equal(accepted, await handler.HandleAsync(command, actor));
        var after = (await Journal().ReadAsync(doc))!;
        Assert.Equal(new NodeStringValue("base"), after.Document.Nodes.Single(n => n.Id == node).Properties["text"]);
        var changed = Assert.Single(after.Document.Screens.Single(s => s.Id == screen).Variants);
        Assert.Equal(2, changed.Overrides.Count);
        Assert.Equal("REVISION_CONFLICT", (await handler.HandleAsync(command with { CommandId = Guid.NewGuid() }, actor)).Code);
        var invalid = command with
        {
            CommandId = Guid.NewGuid(), ExpectedRevision = after.Revision,
            Properties = new Dictionary<string, NodePropertyValue> { ["number"] = new NodeNumberValue(-1) }
        };
        Assert.Equal("INVALID_PROPERTY_VALUE", (await handler.HandleAsync(invalid, actor)).Code);
        Assert.Equal(after.Revision, (await Journal().ReadAsync(doc))!.Revision);
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(command with
        {
            CommandId = Guid.NewGuid(), ExpectedRevision = after.Revision
        }, new("viewer"))).Code);
        Assert.True((await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Empty(Assert.Single((await Journal().ReadAsync(doc))!.Document.Screens.First().Variants).Overrides);
        Assert.True((await handler.HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(2, Assert.Single((await Journal().ReadAsync(doc))!.Document.Screens.First().Variants).Overrides.Count);
    }

    [Fact]
    public async Task ComparisonUsesEffectiveValuesRevisionOwnershipAndPagination()
    {
        await Seed(); var second = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(Add(), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Add(second), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set(), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set(second) with { Value = new NodeStringValue("base") }, actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set() with { Property = "number", Value = new NodeNumberValue(2) }, actor)).Accepted);
        var query = new DocumentScreenVariantDiff(new Authorization(), Journal());
        async Task<ScreenVariantDiffResult> Compare(Guid? from = null, Guid? to = null, long? revision = null, int offset = 0, int limit = 100, DocumentActor? user = null)
            => await query.CompareAsync(doc, screen, from, to, revision, offset, limit, user ?? actor);
        var diff = (await Compare(null, variant)).Response!;
        Assert.Equal(2, diff.Total);
        Assert.Equal(new[] { "number", "text" }, diff.Items.Select(x => x.Property));
        Assert.Equal("text", Assert.Single((await Compare(variant, second, offset: 1, limit: 1)).Response!.Items).Property);
        Assert.Empty((await Compare(null, second)).Response!.Items);
        Assert.Empty((await Compare(null, variant, 2)).Response!.Items);
        Assert.Equal("SCREEN_VARIANT_NOT_FOUND", (await Compare(null, second, 1)).Code);
        Assert.Equal("FORBIDDEN", (await Compare(null, variant, user: new("outsider"))).Code);
        Assert.Equal("INVALID_ID", (await Compare(Guid.Empty)).Code);
        Assert.Equal("INVALID_REVISION", (await Compare(revision: -1)).Code);
        Assert.Equal("INVALID_REVISION", (await Compare(revision: 1000)).Code);
        Assert.Equal("INVALID_QUERY", (await Compare(limit: 101)).Code);
        Assert.Equal("SCREEN_VARIANT_NOT_FOUND", (await query.CompareAsync(doc, other, variant, null, null, 0, 10, actor)).Code);
        Assert.Equal("SCREEN_NOT_FOUND", (await query.CompareAsync(doc, Guid.NewGuid(), null, null, null, 0, 10, actor)).Code);
        Assert.Equal(5, (await Journal().ReadAsync(doc))!.Revision);
    }

    [Fact]
    public async Task DifferencesAreIndependentDurableRevisionAwareAndUndoable()
    {
        await Seed(); var add = Add(); var accepted = await Handler().HandleAsync(add, actor); Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await Handler().HandleAsync(add with { Name = "retry" }, actor));
        var second = Guid.NewGuid(); Assert.True((await Handler().HandleAsync(Add(second), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set(), actor)).Accepted);
        var state = (await Journal().ReadAsync(doc))!; var s = state.Document.Screens.Single(s => s.Id == screen); var n = state.Document.Nodes.Single(n => n.Id == node);
        Assert.Equal(new NodeStringValue("base"), n.Properties["text"]);
        Assert.Equal(new NodeStringValue("difference"), ScreenVariantEditor.ResolveProperty(s.Variants.Single(v => v.Id == variant), n, "text"));
        Assert.Equal(new NodeStringValue("base"), ScreenVariantEditor.ResolveProperty(s.Variants.Single(v => v.Id == second), n, "text"));
        var query = new DocumentScreenVariantQueries(new Authorization(), Journal());
        Assert.Empty(Assert.Single((await query.ReadAsync(doc, screen, variant, 1, 0, 10, actor)).Response!.Items).Overrides);
        Assert.Single(Assert.Single((await query.ReadAsync(doc, screen, variant, 3, 0, 10, actor)).Response!.Items).Overrides);
        Assert.Equal("FORBIDDEN", (await query.ReadAsync(doc, screen, variant, null, 0, 10, new("outsider"))).Code);
        var events = (await Journal().ReadEventsAsync(doc, 0)).Events!; Assert.Equal(3, events.Count); Assert.IsType<ScreenVariantChanged>(events.Last().Payload);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Screens.Single(s => s.Id == screen).Variants.First().Overrides);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        var remove = new RemoveScreenVariantOverrideCommand(doc, Guid.NewGuid(), screen, variant, node, "text");
        Assert.True((await Handler().HandleAsync(remove, actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), node), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set() with { Value = new NodeStringValue("editor") }, new("editor"))).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
    }

    [Fact]
    public async Task InvalidTargetsValuesAndRightsRejectWithoutRevisionChanges()
    {
        await Seed(); Assert.True((await Handler().HandleAsync(Add(), actor)).Accepted);
        var cases = new[] { (Set() with { NodeId = foreign }, "INVALID_VARIANT_NODE"), (Set() with { NodeId = Guid.NewGuid() }, "NODE_NOT_FOUND"),
            (Set() with { Value = new NodeNumberValue(2) }, "INVALID_PROPERTY_TYPE"), (Set() with { Property = "missing" }, "UNSUPPORTED_PROPERTY"),
            (Set() with { Property = "number", Value = new NodeNumberValue(-1) }, "INVALID_PROPERTY_VALUE"),
            (Set() with { Property = "token", Value = new NodeTokenValue(Guid.NewGuid()) }, "missing-reference") };
        foreach (var (command, code) in cases) Assert.Equal(code, (await Handler().HandleAsync(command, actor)).Code);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Set(), new("viewer"))).Code);
        Assert.Equal(1, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(Set(), actor)).Accepted);
        Assert.Equal("SCREEN_VARIANT_IN_USE", (await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), node), actor)).Code);
        Assert.Equal("SCREEN_VARIANT_IN_USE", (await Handler().HandleAsync(new MoveNodeCommand(doc, Guid.NewGuid(), node, screen, other, 1), actor)).Code);
        Assert.True((await Handler().HandleAsync(new MoveNodeCommand(doc, Guid.NewGuid(), node, screen, screen, 0), actor)).Accepted);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Add(), new("viewer"))).Code);
    }

    [Fact]
    public async Task PublicApiPublishesContractsAndAuthorizedHistoricalReads()
    {
        using var key = RSA.Create(2048); var config = ServerTestIdentity.Production(key); config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config); await server.WaitUntilReadyAsync(); using var client = server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = doc })).StatusCode);
        var root = $"/api/v1/documents/{doc}"; var page = Guid.NewGuid();
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-page", new { commandId = Guid.NewGuid(), pageId = page })).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen", new { commandId = Guid.NewGuid(), pageId = page, screenId = screen , dimensions = new { width = 800, height = 600 } })).StatusCode);
        var request = new AddScreenVariantRequest { CommandId = Guid.NewGuid(), ScreenId = screen, VariantId = variant, Name = "Alternate" };
        using var schemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddScreenVariantRequest.json"));
        var schema = JsonSchema.Build(schemaDoc.RootElement.Clone());
        Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(request, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
        Assert.Contains("set-screen-variant-override", await client.GetStringAsync("/openapi/v1.json"));
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen-variant", request)).StatusCode);
        var diffUrl = root + $"/screens/{screen}/variant-diff?toVariantId={variant}";
        var diff = (await client.GetFromJsonAsync<ScreenVariantDiffResponse>(diffUrl))!;
        Assert.Empty(diff.Items);
        using (var diffSchema = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/ScreenVariantDiffResponse.json")))
            Assert.True(JsonSchema.Build(diffSchema.RootElement.Clone()).EvaluateNode(JsonSerializer.SerializeToNode(diff, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        Assert.Contains("variant-diff", await client.GetStringAsync("/openapi/v1.json"));
        Assert.Equal(400, (int)(await client.GetAsync(diffUrl + "&limit=101")).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(root + $"/screens/{screen}/variant-diff?toVariantId={Guid.NewGuid()}")).StatusCode);
        var response = (await client.GetFromJsonAsync<ScreenVariantsResponse>(root + $"/screens/{screen}/variants?revision=3"))!;
        Assert.Equal(variant, Assert.Single(response.Items).Id);
        Assert.Empty((await client.GetFromJsonAsync<ScreenVariantsResponse>(root + $"/screens/{screen}/variants?revision=2"))!.Items);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var setRequest = new SetScreenVariantOverrideRequest { CommandId = Guid.NewGuid(), ScreenId = screen, VariantId = variant,
            NodeId = node, Property = "text", Value = new NodeStringValue("alternate") };
        var removeRequest = new RemoveScreenVariantOverrideRequest { CommandId = Guid.NewGuid(), ScreenId = screen, VariantId = variant,
            NodeId = node, Property = "text" };
        foreach (var (type, payload) in new[] {
            (nameof(SetScreenVariantOverrideRequest), JsonSerializer.SerializeToNode(setRequest, options)!),
            (nameof(RemoveScreenVariantOverrideRequest), JsonSerializer.SerializeToNode(removeRequest, options)!),
            (nameof(ScreenVariantsResponse), JsonSerializer.SerializeToNode(response, options)!) })
        {
            using var definition = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/schemas/{type}.json"));
            Assert.True(JsonSchema.Build(definition.RootElement.Clone()).EvaluateNode(payload).IsValid);
        }
        Assert.Equal(404, (int)(await client.PostAsJsonAsync(root + "/commands/set-screen-variant-override", setRequest)).StatusCode);
        Assert.Equal(404, (int)(await client.PostAsJsonAsync(root + "/commands/remove-screen-variant-override", removeRequest)).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(root + $"/screens/{screen}/variants?limit=101")).StatusCode);
        Assert.Equal(400, (int)(await client.GetAsync(root + $"/screens/{screen}/variants?revision=-1")).StatusCode);
        Assert.Equal(404, (int)(await client.GetAsync(root + $"/screens/{screen}/variants?variantId={Guid.NewGuid()}")).StatusCode);
        await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" });
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
        Assert.Equal(200, (int)(await client.GetAsync(root + $"/screens/{screen}/variants")).StatusCode);
        Assert.Equal(200, (int)(await client.GetAsync(diffUrl)).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen-variant", request)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
        Assert.Equal(403, (int)(await client.GetAsync(root + $"/screens/{screen}/variants")).StatusCode);
        Assert.Equal(403, (int)(await client.GetAsync(diffUrl)).StatusCode);
    }
    [Fact]
    public async Task VariantIdsAreUniqueAcrossTheDocumentIncludingComponentEntities()
    {
        await Seed();
        var page = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), page), actor)).Accepted);
        var definition = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(new AddComponentDefinitionCommand(doc, Guid.NewGuid(), definition, "Component", "", foreign), actor)).Accepted);
        var componentVariant = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(new AddComponentVariantCommand(doc, Guid.NewGuid(), definition,
            new(componentVariant, "Custom", ComponentVariantKind.Custom, null, new Dictionary<Guid, ComponentValue>())), actor)).Accepted);
        foreach (var occupied in new[] { doc, screen, node, page, definition, componentVariant })
            Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(Add(occupied), actor)).Code);
        Assert.True((await Handler().HandleAsync(Add(), actor)).Accepted);
        var before = JsonSerializer.Serialize(await Journal().ReadAsync(doc));
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), variant), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddScreenCommand(doc, Guid.NewGuid(), page, variant, new(800, 600)), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddNodeCommand(doc, Guid.NewGuid(), screen, variant, "test"), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), variant, "Fixture", "[]"), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddComponentVariantCommand(doc, Guid.NewGuid(), definition,
            new(variant, "Collision", ComponentVariantKind.Custom, null, new Dictionary<Guid, ComponentValue>())), actor)).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await Journal().ReadAsync(doc)));
    }

    [Fact]
    public async Task CheckpointsPreserveOverridesAndHistoricalReadsAndSafeRedo()
    {
        await Seed();
        Assert.True((await Handler().HandleAsync(Add(), actor)).Accepted);
        var set = Set(); var accepted = await Handler().HandleAsync(set, actor); Assert.True(accepted.Accepted);
        for (var i = 0; i < 35; i++)
            Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        var query = new DocumentScreenVariantQueries(new Authorization(), Journal());
        Assert.Single(Assert.Single((await query.ReadAsync(doc, screen, variant, 2, 0, 10, actor)).Response!.Items).Overrides);
        Assert.Equal(accepted, await Handler().HandleAsync(set, actor));
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Empty(Assert.Single((await query.ReadAsync(doc, screen, variant, null, 0, 10, actor)).Response!.Items).Overrides);
        Assert.True((await Handler().HandleAsync(Set() with { Value = new NodeStringValue("concurrent") }, new("editor"))).Accepted);
        Assert.Equal("REDO_NOT_APPLICABLE", (await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
        Assert.Equal(new NodeStringValue("concurrent"), Assert.Single(Assert.Single((await query.ReadAsync(doc, screen, variant, null, 0, 10, actor)).Response!.Items).Overrides).Value);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(set, new("viewer"))).Code);
    }

    [Fact]
    public async Task TypedReferencesAndProfileConstraintsApplyToOverrides()
    {
        await Seed();
        var spacing = Guid.NewGuid(); var color = Guid.NewGuid();
        IReadOnlyDictionary<TokenTheme, TokenExpression> Values(TokenValue value) => new Dictionary<TokenTheme, TokenExpression> {
            [TokenTheme.Light] = new LiteralTokenValue(value), [TokenTheme.Dark] = new LiteralTokenValue(value) };
        Assert.True((await Handler().HandleAsync(new AddTokenCommand(doc, Guid.NewGuid(), new(spacing, "Gap", TokenType.Spacing, Values(new SpacingValue(8)))), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddTokenCommand(doc, Guid.NewGuid(), new(color, "Color", TokenType.Color, Values(new ColorValue(1, 2, 3)))), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Add(), actor)).Accepted);
        foreach (var (property, value, code) in new (string, NodePropertyValue, string)[] {
            ("token", new NodeTokenValue(color), "type-mismatch"), ("asset", new NodeAssetValue(Guid.NewGuid()), "missing-reference"),
            ("choice", new NodeEnumValue("unknown"), "INVALID_PROPERTY_VALUE"), ("number", new NodeNumberValue(double.NaN), "INVALID_PROPERTY_VALUE") })
            Assert.Equal(code, (await Handler().HandleAsync(Set() with { Property = property, Value = value }, actor)).Code);
        Assert.Equal(3, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(Set() with { Property = "token", Value = new NodeTokenValue(spacing) }, actor)).Accepted);
        Assert.True((await Handler().HandleAsync(Set() with { Property = "choice", Value = new NodeEnumValue("second") }, actor)).Accepted);
        Assert.Equal(2, (await Journal().ReadAsync(doc))!.Document.Screens.Single(s => s.Id == screen).Variants.Single().Overrides.Count);
        var diagnostics = new DocumentDiagnostics(new Authorization(), Journal(), new EmptyNodeProfile());
        var response = (await diagnostics.ReadAsync(doc, screen, null, 0, 100, actor)).Response!;
        Assert.Contains(response.Items, d => d.Code == "UNSUPPORTED_PROPERTY" && d.Path.Contains("/variants/" + variant));
    }

    [Fact]
    public void MalformedVariantsReturnDiagnosticsDuringComponentValidation()
    {
        foreach (var variants in new IReadOnlyList<ScreenVariant>[] { null!, [null!] })
        {
            var structure = new DocumentStructure(doc, [], [new(screen, [], new(800, 600)) { Variants = variants }], []);
            Assert.Contains(ComponentValidator.Validate(new(structure, [], [], [], []), new Profile()), d => d.Code == "INVALID_SCREEN_VARIANT");
        }
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}

