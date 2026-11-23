using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;

namespace FigVam.Server.Tests;

public sealed class ScenarioTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-scenarios-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), screen = Guid.NewGuid(), other = Guid.NewGuid(), node = Guid.NewGuid(), foreign = Guid.NewGuid(), variant = Guid.NewGuid(), id = Guid.NewGuid();
    private readonly DocumentActor actor = new("owner");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent @event) => kind == "test" && Enum.IsDefined(@event);
        public bool SupportsPreviewAction(PreviewAction action) => action is Navigate or ShowVariant or SelectDataset or SetDemoValue or OpenOverlay or CloseOverlay or ResetPreview;
        public bool SupportsDemoValue(string kind) => kind == "test";
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Authorization(), Journal(), new Profile());
    private Task Seed() => Journal().InitializeAsync(new(doc, [], [new(screen, [node], new(800, 600)) { Variants = [new(variant, "Alternate", [])] }, new(other, [foreign], new(800, 600))], [new(node, "test", []), new(foreign, "test", [])]));
    private PreviewScenario Scenario() => new(id, screen, node, PreviewEvent.Click, [new ShowVariant(variant), new SetDemoValue(node, "demo"), new Navigate(other)]);
    private Task<ScenariosResult> Read(long? revision = null, DocumentActor? user = null) => new DocumentScenarioQueries(new Authorization(), Journal()).ReadAsync(doc, null, null, revision, 0, 100, user ?? actor);

    [Fact]
    public async Task CommandsRecoverWithEventsIdempotencyHistoryAndSavedVersions()
    {
        await Seed(); var create = new CreateScenarioCommand(doc, Guid.NewGuid(), Scenario());
        var accepted = await Handler().HandleAsync(create, actor); Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await Handler().HandleAsync(create with { Scenario = Scenario() with { NodeId = foreign } }, actor));
        Assert.Empty((await Read(0)).Response!.Items);
        Assert.Single((await Read(1)).Response!.Items);
        Assert.IsType<ScenarioChanged>(Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!).Payload);
        var save = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid()), actor); Assert.True(save.Accepted);
        var update = new UpdateScenarioCommand(doc, Guid.NewGuid(), Scenario() with { Actions = [new ResetPreview()] }, 2);
        Assert.True((await Handler().HandleAsync(update, actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(3, Assert.Single((await Read()).Response!.Items).Actions.Count);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        Assert.IsType<ResetPreview>(Assert.Single(Assert.Single((await Read()).Response!.Items).Actions));
        Assert.True((await Handler().HandleAsync(new DeleteScenarioCommand(doc, Guid.NewGuid(), id, 5), actor)).Accepted);
        Assert.Empty((await Read()).Response!.Items);
        Assert.Single((await Journal().ReadVersionAsync(doc, save.VersionId!.Value)).Version!.Snapshot.Document.Scenarios);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), save.VersionId.Value), actor)).Accepted);
        for (var i = 0; i < 35; i++) Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Accepted);
        Assert.Equal(3, Assert.Single((await Read()).Response!.Items).Actions.Count);
        Assert.Single((await Read(1)).Response!.Items);
        Assert.True((await Handler().HandleAsync(new UpdateScenarioCommand(doc, Guid.NewGuid(), Scenario() with { Actions = [new CloseOverlay()] }, 42), new("editor"))).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
    }

    [Fact]
    public async Task ReferencesProfilesLimitsAndViewerRejectWithoutMutations()
    {
        await Seed();
        foreach (var scenario in new[] { Scenario() with { NodeId = foreign }, Scenario() with { ScreenId = node }, Scenario() with { Event = (PreviewEvent)99 },
            Scenario() with { Actions = [new Navigate(node)] }, Scenario() with { Actions = [new ShowVariant(foreign)] },
            Scenario() with { Actions = [new Navigate(other), new ShowVariant(variant)] }, Scenario() with { Actions = [new SetDemoValue(foreign, "x")] },
            Scenario() with { Actions = [new SelectDataset(node)] }, Scenario() with { Actions = [new OpenOverlay(node)] }, Scenario() with { Actions = [] },
            Scenario() with { Actions = [new SetDemoValue(node, new string('a', 4097))] } })
            Assert.Equal("INVALID_SCENARIO", (await Handler().HandleAsync(new CreateScenarioCommand(doc, Guid.NewGuid(), scenario), actor)).Code);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(new CreateScenarioCommand(doc, Guid.NewGuid(), Scenario()), new("viewer"))).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(new CreateScenarioCommand(doc, Guid.NewGuid(), Scenario()), actor)).Accepted);
        Assert.Equal("SCENARIO_IN_USE", (await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), node), actor)).Code);
        Assert.Equal("SCENARIO_IN_USE", (await Handler().HandleAsync(new MoveNodeCommand(doc, Guid.NewGuid(), node, screen, other, 1), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), id), actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), id, "Collision", "[]"), actor)).Code);
        Assert.Equal("REVISION_CONFLICT", (await Handler().HandleAsync(new DeleteScenarioCommand(doc, Guid.NewGuid(), id, 0), actor)).Code);
        Assert.Equal("FORBIDDEN", (await Read(user: new("outsider"))).Code);
        Assert.Single((await Read(user: new("viewer"))).Response!.Items);
        Assert.Equal(1, (await Journal().ReadAsync(doc))!.Revision);
        Assert.Contains(DocumentStructureValidator.Validate((await Journal().ReadAsync(doc))!.Document, new EmptyNodeProfile()), e => e.Code == "INVALID_SCENARIO");
    }

    [Fact]
    public async Task DatasetReferencesAndConcurrentScenarioEditsAreProtected()
    {
        await Seed(); var dataset = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(new AddDatasetCommand(doc, Guid.NewGuid(), dataset, "Local", "[]"), actor)).Accepted);
        var scenario = Scenario() with { Actions = [new SelectDataset(dataset), new OpenOverlay(other), new SetDemoValue(foreign, "overlay"), new CloseOverlay(), new ShowVariant(variant)] };
        Assert.True((await Handler().HandleAsync(new CreateScenarioCommand(doc, Guid.NewGuid(), scenario), actor)).Accepted);
        Assert.Equal("SCENARIO_IN_USE", (await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 2), actor)).Code);
        Assert.True((await Handler().HandleAsync(new UpdateScenarioCommand(doc, Guid.NewGuid(), scenario with { Actions = [new ResetPreview()] }, 2), new("editor"))).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Code);
        Assert.True((await Handler().HandleAsync(new DeleteDatasetCommand(doc, Guid.NewGuid(), dataset, 3), actor)).Accepted);
        var changes = (await new DocumentRevisionDiff(new Authorization(), Journal()).CompareAsync(doc, 1, 3, 0, 100, actor)).Response!;
        Assert.Contains(changes.Items, item => item.Id == id && item.Type == "scenario");
    }

    [Fact]
    public async Task UpdateChecksEditAccessAndRevisionAndPersistsOrderedActionsOnce()
    {
        await Seed();
        Assert.True((await Handler().HandleAsync(new CreateScenarioCommand(doc, Guid.NewGuid(), Scenario()), actor)).Accepted);
        var changed = Scenario() with { Event = PreviewEvent.Change, Actions = [new OpenOverlay(other), new SetDemoValue(foreign, ""), new CloseOverlay(), new ShowVariant(null)] };
        var update = new UpdateScenarioCommand(doc, Guid.NewGuid(), changed, 1);

        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(update, new("viewer"))).Code);
        Assert.Equal("REVISION_CONFLICT", (await Handler().HandleAsync(update with { CommandId = Guid.NewGuid(), ExpectedRevision = 0 }, actor)).Code);
        var before = (await Read()).Response!;
        Assert.Equal(1, before.Revision);
        Assert.Equal(PreviewEvent.Click, Assert.Single(before.Items).Event);

        var editor = new DocumentActor("editor");
        var accepted = await Handler().HandleAsync(update, editor);
        Assert.True(accepted.Accepted);
        Assert.Equal(2, accepted.Revision);
        Assert.Equal(accepted, await Handler().HandleAsync(update, editor));
        var after = (await Read(user: new("viewer"))).Response!;
        Assert.Equal(2, after.Revision);
        var scenario = Assert.Single(after.Items);
        Assert.Equal(PreviewEvent.Change, scenario.Event);
        Assert.Equal(changed.Actions, scenario.Actions);
        var committed = Assert.Single((await Journal().ReadEventsAsync(doc, 1)).Events!);
        Assert.Equal(update.CommandId, committed.CommandId);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
