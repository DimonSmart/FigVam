using System.Collections.Immutable;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
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
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch {
            "text" => new(NodePropertyType.String), "number" => new(NodePropertyType.Number, v => ((NodeNumberValue)v).Value >= 0 ? null : "Must be nonnegative."), "token" => new(NodePropertyType.TokenReference), _ => null };
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Authorization(), Journal(), new Profile());
    private Task Seed() => Journal().InitializeAsync(new(doc, [], [new(screen, [node]), new(other, [foreign])], [new(node, "test", []) { Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("text", new NodeStringValue("base")) }, new(foreign, "test", [])]));
    private AddScreenVariantCommand Add(Guid? id = null) => new(doc, Guid.NewGuid(), screen, id ?? variant, "Alternate");
    private SetScreenVariantOverrideCommand Set(Guid? id = null) => new(doc, Guid.NewGuid(), screen, id ?? variant, node, "text", new NodeStringValue("difference"));

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
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen", new { commandId = Guid.NewGuid(), pageId = page, screenId = screen })).StatusCode);
        var request = new AddScreenVariantRequest { CommandId = Guid.NewGuid(), ScreenId = screen, VariantId = variant, Name = "Alternate" };
        using var schemaDoc = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/AddScreenVariantRequest.json"));
        var schema = JsonSchema.Build(schemaDoc.RootElement.Clone());
        Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(request, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).IsValid);
        Assert.False(schema.EvaluateNode(JsonNode.Parse("{}")!).IsValid);
        Assert.Contains("set-screen-variant-override", await client.GetStringAsync("/openapi/v1.json"));
        Assert.Equal(200, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen-variant", request)).StatusCode);
        var response = (await client.GetFromJsonAsync<ScreenVariantsResponse>(root + $"/screens/{screen}/variants?revision=3"))!;
        Assert.Equal(variant, Assert.Single(response.Items).Id);
        Assert.Empty((await client.GetFromJsonAsync<ScreenVariantsResponse>(root + $"/screens/{screen}/variants?revision=2"))!.Items);
        await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" });
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
        Assert.Equal(200, (int)(await client.GetAsync(root + $"/screens/{screen}/variants")).StatusCode);
        Assert.Equal(403, (int)(await client.PostAsJsonAsync(root + "/commands/add-screen-variant", request)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
        Assert.Equal(403, (int)(await client.GetAsync(root + $"/screens/{screen}/variants")).StatusCode);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
