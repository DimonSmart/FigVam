using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class AtomicNodeCommandTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-atomic-node-" + Guid.NewGuid());
    private readonly Guid documentId = Guid.NewGuid();
    private readonly Guid pageId = Guid.NewGuid();
    private readonly Guid screenId = Guid.NewGuid();
    private readonly Guid nodeId = Guid.NewGuid();
    private readonly DocumentActor owner = new("owner");
    private readonly DocumentActor viewer = new("viewer");
    private readonly DocumentActor editor = new("editor");
    private readonly VisualNodeProfile profile = new();

    [Fact]
    public async Task ImageCreationValidatesAllPropertiesAndRecoversAsOneUndoableEvent()
    {
        var journal = Journal();
        var handler = await Initialize(journal);
        var assetId = Guid.NewGuid();
        var create = new AddNodeCommand(documentId, Guid.NewGuid(), screenId, nodeId, "Image");
        var missing = await handler.HandleAsync(create, owner);
        Assert.Equal("REQUIRED_PROPERTY", missing.Code);
        Assert.Equal("asset", missing.Property);
        var properties = Geometry(10, 20, 100, 50);
        properties["asset"] = new NodeAssetValue(assetId);
        properties["fit"] = new NodeEnumValue("Cover");

        var dangling = create with { CommandId = Guid.NewGuid(), Properties = properties };
        var absent = await handler.HandleAsync(dangling, owner);
        Assert.Equal("ASSET_NOT_FOUND", absent.Code);
        Assert.Equal(nodeId, absent.NodeId);
        Assert.Equal("asset", absent.Property);
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(dangling, viewer)).Code);
        var rejected = (await journal.ReadAsync(documentId))!;
        Assert.Equal(2, rejected.Revision);
        Assert.Empty(rejected.Document.Nodes);
        Assert.Empty(Assert.Single(rejected.Document.Screens).ChildIds);

        var upload = await handler.HandleAsync(
            new UploadDocumentAssetCommand(documentId, Guid.NewGuid(), assetId, "image/png", DocumentAssetTests.Png()), owner);
        Assert.True(upload.Accepted);
        Assert.Equal(absent, await handler.HandleAsync(dangling, owner));
        var valid = dangling with { CommandId = Guid.NewGuid() };
        var accepted = await handler.HandleAsync(valid, owner);
        Assert.Equal(4, accepted.Revision);
        Assert.Equal(accepted, await handler.HandleAsync(valid with { Properties = null }, owner));

        var reopened = Journal();
        var restored = (await reopened.ReadAsync(documentId))!;
        Assert.Equal(4, restored.Revision);
        var image = Assert.Single(restored.Document.Nodes);
        Assert.Equal(nodeId, image.Id);
        Assert.Equal(nodeId, Assert.Single(Assert.Single(restored.Document.Screens).ChildIds));
        Assert.Equal(properties.OrderBy(p => p.Key, StringComparer.Ordinal), image.Properties);
        var addEvent = Assert.Single((await reopened.ReadEventsAsync(documentId, 3)).Events!);
        Assert.Equal("ADD_NODE", addEvent.Type);
        Assert.Equal(image.Properties, Assert.IsType<NodeAdded>(addEvent.Payload).Properties);

        var child = create with { CommandId = Guid.NewGuid(), NodeId = Guid.NewGuid(), ParentId = nodeId, Kind = "Text" };
        handler = new(reopened, reopened, profile);
        Assert.Equal("CHILDREN_NOT_ALLOWED", (await handler.HandleAsync(child, owner)).Code);
        Assert.Equal(accepted, await handler.HandleAsync(valid, owner));
        Assert.Equal(5, (await handler.HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), owner)).Revision);
        Assert.Empty((await Journal().ReadAsync(documentId))!.Document.Nodes);
        Assert.Equal(6, (await handler.HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), owner)).Revision);
        Assert.Equal(image.Properties, Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties);
    }

    [Fact]
    public async Task GeometryEditCommitsAllValuesTogetherAndRejectsInvalidOrStaleChanges()
    {
        var journal = Journal();
        var handler = await Initialize(journal);
        var original = Geometry(10, 20, 100, 50);
        Assert.Equal(3, (await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screenId, nodeId, "Frame", original), owner)).Revision);
        var invalidProperties = Geometry(50, 60, 120, -1);
        var invalid = new SetNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, invalidProperties, screenId, 3);
        var bad = await handler.HandleAsync(invalid, owner);
        Assert.Equal("INVALID_PROPERTY_VALUE", bad.Code);
        Assert.Equal("height", bad.Property);
        Assert.Equal(bad, await handler.HandleAsync(invalid with { Properties = original }, owner));
        var edit = new SetNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, Geometry(70, 80, 130, 90), screenId, 3);
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(edit, viewer)).Code);
        Assert.Equal(3, (await journal.ReadAsync(documentId))!.Revision);
        Assert.Equal(original.OrderBy(p => p.Key, StringComparer.Ordinal),
            Assert.Single((await journal.ReadAsync(documentId))!.Document.Nodes).Properties);

        var other = edit with { CommandId = Guid.NewGuid(), Properties = Geometry(1, 2, 3, 4) };
        var reopened = Journal();
        var secondHandler = new DocumentCommandHandler(reopened, reopened, profile);
        var results = await Task.WhenAll(
            Task.Run(() => handler.HandleAsync(edit, owner)),
            Task.Run(() => secondHandler.HandleAsync(other, editor)));
        Assert.Equal(4, Assert.Single(results, r => r.Accepted).Revision);
        Assert.Equal("REVISION_CONFLICT", Assert.Single(results, r => !r.Accepted).Code);
        var (winner, actor) = results[0].Accepted ? (edit, owner) : (other, editor);
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(4, state.Revision);
        Assert.Equal(winner.Properties.OrderBy(p => p.Key, StringComparer.Ordinal), Assert.Single(state.Document.Nodes).Properties);
        var propertiesEvent = Assert.Single((await Journal().ReadEventsAsync(documentId, 3)).Events!);
        Assert.Equal("SET_NODE_PROPERTIES", propertiesEvent.Type);
        Assert.Equal(winner.Properties.OrderBy(p => p.Key, StringComparer.Ordinal), Assert.IsType<NodePropertiesSet>(propertiesEvent.Payload).Properties);
        Assert.Equal(Assert.Single(results, r => r.Accepted), await secondHandler.HandleAsync(winner, actor));

        Assert.Equal(5, (await secondHandler.HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), actor)).Revision);
        Assert.Equal(original.OrderBy(p => p.Key, StringComparer.Ordinal), Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties);
        Assert.Equal(6, (await secondHandler.HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), actor)).Revision);
        Assert.Equal(winner.Properties.OrderBy(p => p.Key, StringComparer.Ordinal), Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties);

        var newParent = Guid.NewGuid();
        Assert.Equal(7, (await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screenId, newParent, "Frame"), owner)).Revision);
        Assert.Equal(8, (await secondHandler.HandleAsync(new MoveNodeCommand(documentId, Guid.NewGuid(), nodeId, screenId, newParent, 0), editor)).Revision);
        var stale = edit with { CommandId = Guid.NewGuid(), ExpectedRevision = null };
        Assert.Equal("INVALID_LAYOUT_CONTEXT", (await handler.HandleAsync(stale, owner)).Code);
        Assert.Equal(9, (await handler.HandleAsync(new DeleteNodeCommand(documentId, Guid.NewGuid(), nodeId), editor)).Revision);
        Assert.Equal("NODE_NOT_FOUND", (await handler.HandleAsync(stale with { CommandId = Guid.NewGuid() }, owner)).Code);
        Assert.Equal(9, (await journal.ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task SpacingCommandsPreserveReferencesAndRejectInvalidValuesAndTokenEdits()
    {
        var journal = Journal();
        var handler = await Initialize(journal);
        async Task<Guid> AddToken(string name, TokenType type, TokenExpression light, TokenExpression dark)
        {
            var token = new DesignToken(Guid.NewGuid(), name, type, new Dictionary<TokenTheme, TokenExpression>
                { [TokenTheme.Light] = light, [TokenTheme.Dark] = dark });
            Assert.True((await handler.HandleAsync(new AddTokenCommand(documentId, Guid.NewGuid(), token), owner)).Accepted);
            return token.Id;
        }
        var spacing = new LiteralTokenValue(new SpacingValue(8));
        var outOfRange = new LiteralTokenValue(new SpacingValue(1_000_001));
        var valid = await AddToken("Spacing", TokenType.Spacing, spacing, spacing);
        var alias = await AddToken("Semantic gap", TokenType.Spacing, new TokenAlias(valid), new TokenAlias(valid));
        var invalid = await AddToken("Large spacing", TokenType.Spacing, spacing, outOfRange);
        var black = new LiteralTokenValue(new ColorValue(0, 0, 0));
        var color = await AddToken("Color", TokenType.Color, black, black);
        Dictionary<string, NodePropertyValue> Gap(Guid id) => new() { ["gap"] = new NodeTokenValue(id) };
        var created = await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screenId, nodeId, "Frame", Gap(valid)), owner);
        Assert.True(created.Accepted);
        var initial = (await journal.ReadAsync(documentId))!;

        foreach (var (code, tokenId) in new[] { ("TOKEN_NOT_FOUND", Guid.NewGuid()), ("INVALID_PROPERTY_VALUE", color), ("INVALID_PROPERTY_VALUE", invalid) })
        {
            var result = await handler.HandleAsync(new SetNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, Gap(tokenId)), owner);
            Assert.Equal((code, "gap", nodeId), (result.Code, result.Property, result.NodeId));
            if (tokenId == invalid) Assert.Contains("Dark", result.Explanation);
        }
        Assert.Equal(initial.Revision, (await journal.ReadAsync(documentId))!.Revision);

        var edit = await handler.HandleAsync(new SetNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, Gap(alias)), owner);
        Assert.True(edit.Accepted);
        var tokenEdit = await handler.HandleAsync(new SetTokenValueCommand(documentId, Guid.NewGuid(), valid, TokenTheme.Dark, outOfRange), owner);
        Assert.Equal("INVALID_TOKEN", tokenEdit.Code);
        Assert.Contains("gap", tokenEdit.Explanation);
        Assert.Equal(edit.Revision, (await journal.ReadAsync(documentId))!.Revision);
        var save = await handler.HandleAsync(new SaveDocumentCommand(documentId, Guid.NewGuid(), "Spacing reference"), owner);
        Assert.True(save.Accepted);
        var restored = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(save.Revision, restored.Revision);
        Assert.Equal(new NodeTokenValue(alias), Assert.Single(restored.Document.Nodes).Properties["gap"]);
    }

    [Fact]
    public async Task ShadowCommandsPersistReplayAndRoundTripWithoutSpecialCommands()
    {
        var journal = Journal();
        var handler = await Initialize(journal);
        Assert.True((await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screenId, nodeId, "Frame"), owner)).Accepted);
        var shadow = new NodeShadowValue(0, 4, 8, -2, new(0, 0, 0, 38));
        var added = await handler.HandleAsync(new SetNodePropertyCommand(documentId, Guid.NewGuid(), nodeId, "shadow", shadow), owner);
        Assert.True(added.Accepted, added.Code);
        var updated = shadow with { OffsetY = 12, BlurRadius = 32 };
        var edited = await handler.HandleAsync(new SetNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId,
            new Dictionary<string, NodePropertyValue> { ["shadow"] = updated }), editor);
        Assert.True(edited.Accepted, edited.Code);
        var reopened = Journal();
        var snapshot = (await reopened.ReadAsync(documentId))!;
        Assert.Equal(updated, Assert.Single(snapshot.Document.Nodes).Properties["shadow"]);
        var change = Assert.Single((await reopened.ReadEventsAsync(documentId, added.Revision!.Value)).Events!);
        Assert.Equal(updated, Assert.IsType<NodePropertiesSet>(change.Payload).Properties["shadow"]);
        var exporter = new DocumentJsonExporter(reopened, reopened, reopened, profile);
        var json = await exporter.ExportAsync(documentId, null, null, owner);
        Assert.Equal("OK", json.Code);
        var reader = new DocumentFileReader(profile);
        var imported = await reader.ReadJsonAsync(new MemoryStream(json.Content!));
        Assert.Empty(imported.Diagnostics);
        Assert.Equal(updated, Assert.Single(imported.Document!.Document.Nodes).Properties["shadow"]);
        var container = await new DocumentContainerExporter(exporter, reopened).ExportAsync(documentId, null, null, owner);
        Assert.Equal("OK", container.Code);
        var readContainer = await reader.ReadContainerAsync(new MemoryStream(container.Content!));
        Assert.Empty(readContainer.Diagnostics);
        Assert.Equal(updated, Assert.Single(readContainer.Document!.Document.Nodes).Properties["shadow"]);

        var remove = await handler.HandleAsync(new RemoveNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, ["shadow"], snapshot.Revision), owner);
        Assert.True(remove.Accepted, remove.Code);
        Assert.False(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties.ContainsKey("shadow"));
        Assert.True((await handler.HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(updated, Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties["shadow"]);
        Assert.True((await handler.HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), owner)).Accepted);
        Assert.False(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties.ContainsKey("shadow"));
    }

    private static Dictionary<string, NodePropertyValue> Geometry(double x, double y, double width, double height) => new()
    {
        ["x"] = new NodeNumberValue(x),
        ["y"] = new NodeNumberValue(y),
        ["width"] = new NodeNumberValue(width),
        ["height"] = new NodeNumberValue(height)
    };

    private SqliteDocumentJournal Journal() => new(directory, profile);

    private async Task<DocumentCommandHandler> Initialize(SqliteDocumentJournal journal)
    {
        Assert.True((await journal.CreateAsync(new(documentId), owner)).Accepted);
        await journal.SetMemberAsync(documentId, viewer.Id, DocumentRole.Viewer, owner);
        await journal.SetMemberAsync(documentId, editor.Id, DocumentRole.Editor, owner);
        var handler = new DocumentCommandHandler(journal, journal, profile);
        Assert.True((await handler.HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), pageId), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddScreenCommand(documentId, Guid.NewGuid(), pageId, screenId, new(800, 600)), owner)).Accepted);
        return handler;
    }

    public void Dispose()
    {
        if (Directory.Exists(directory))
            Directory.Delete(directory, recursive: true);
    }
}
