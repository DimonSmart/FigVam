using FigVam.Application.Connectors;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentPreviewTests
{
    private sealed class NoRemoteReader : IRemoteJsonReader
    {
        public Task<RemoteJsonResult> ReadAsync(string connectorId, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("Preview creation must not fetch remote data.");
    }
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Version1;
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
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "viewer");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentStructure document) : IDocumentStateReader
    {
        public int Reads { get; private set; }
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct)
        {
            Reads++;
            return Task.FromResult(revision is null or 7 ? new DocumentStateReadResult("OK", new(document, 7)) : new("REVISION_NOT_FOUND"));
        }
    }
    private sealed class Fixture
    {
        public Guid Screen = Guid.NewGuid(), Other = Guid.NewGuid(), Overlay = Guid.NewGuid(), Node = Guid.NewGuid(), Child = Guid.NewGuid(), OtherNode = Guid.NewGuid(), OverlayNode = Guid.NewGuid();
        public Guid Variant = Guid.NewGuid(), OtherVariant = Guid.NewGuid(), Dataset = Guid.NewGuid();
        public DocumentStructure Document { get; }
        public PreviewSelection Selection => new(Screen, Variant, Dataset, TokenTheme.Dark, new(1024, 768));
        public Fixture()
        {
            Document = new(Guid.NewGuid(), [],
                [new(Screen, [Node], new(800, 600)) { Variants = [new(Variant, "First", [])] }, new(Other, [OtherNode], new(800, 600)) { Variants = [new(OtherVariant, "Second", [])] }, new(Overlay, [OverlayNode], new(800, 600))],
                [new(Node, "test", [Child]), new(Child, "test", []), new(OtherNode, "test", []), new(OverlayNode, "test", [])])
            { Datasets = [new(Dataset, "Examples", "[]")] };
        }
        public PreviewScenario Scenario(Guid screen, Guid node, PreviewEvent @event, params PreviewAction[] actions) => new(Guid.NewGuid(), screen, node, @event, actions);
        public Task<DocumentPreviewResult> Create(DocumentStructure? document = null, PreviewSelection? selection = null) => new DocumentPreviewFactory(new Authorization(), new Reader(document ?? Document), new Profile(), new NoRemoteReader())
            .CreateAsync(Document.Id, 7, selection ?? Selection, new("viewer"));
    }

    [Fact]
    public async Task SessionUsesOneAuthorizedRevisionAndNeverMutatesTheDocument()
    {
        var f = new Fixture();
        var document = f.Document with { Scenarios = [f.Scenario(f.Screen, f.Child, PreviewEvent.Change, new SetDemoValue(f.Child, "local"), new SelectDataset(null))] };
        var before = JsonSerializer.Serialize(document);
        var reader = new Reader(document);
        var factory = new DocumentPreviewFactory(new Authorization(), reader, new Profile(), new NoRemoteReader());
        Assert.Equal("FORBIDDEN", (await factory.CreateAsync(document.Id, 7, f.Selection, new("outsider"))).Code);
        Assert.Equal(0, reader.Reads);
        var result = await factory.CreateAsync(document.Id, 7, f.Selection, new("viewer"));
        Assert.Equal("OK", result.Code);
        Assert.Equal(1, reader.Reads);
        Assert.Equal(document.Id, result.Preview!.DocumentId);
        Assert.Equal(7, result.Preview.Revision);
        var start = result.Preview.Session;
        Assert.Equal(f.Selection, start.Selection);
        var changed = start.Trigger(f.Child, PreviewEvent.Change);
        Assert.Equal("local", changed.Values[f.Child]);
        Assert.Null(changed.Selection.DatasetId);
        Assert.Equal(f.Variant, changed.Selection.VariantId);
        Assert.Empty(start.Values);
        Assert.Equal(before, JsonSerializer.Serialize(document));
        Assert.Equal("REVISION_NOT_FOUND", (await factory.CreateAsync(document.Id, 6, f.Selection, new("viewer"))).Code);
        Assert.Equal("INVALID_DOCUMENT", (await new DocumentPreviewFactory(new Authorization(), reader, new UnverifiedNodeProfile(), new NoRemoteReader()).CreateAsync(document.Id, 7, f.Selection, new("viewer"))).Code);
    }

    [Fact]
    public async Task ActionsNavigateWithOwnedVariantsAndIndependentDatasetAndBackRestoresAllAxes()
    {
        var f = new Fixture();
        var document = f.Document with { Scenarios = [f.Scenario(f.Screen, f.Child, PreviewEvent.Click,
            new SetDemoValue(f.Child, "first"), new Navigate(f.Other), new ShowVariant(f.OtherVariant), new SelectDataset(null), new SetDemoValue(f.OtherNode, "second"))] };
        var start = (await f.Create(document)).Preview!.Session;
        var next = start.Trigger(f.Child, PreviewEvent.Click);
        Assert.Equal(f.Other, next.Selection.ScreenId);
        Assert.Equal(f.OtherVariant, next.Selection.VariantId);
        Assert.Null(next.Selection.DatasetId);
        Assert.Equal(2, next.Values.Count);
        Assert.Equal(start.Selection, next.Back().Selection);
        Assert.Empty(next.Back().Values);
        var selected = next.Select(next.Selection with { DatasetId = f.Dataset, Theme = TokenTheme.Light, Viewport = new(320, 600) });
        Assert.Equal(f.OtherVariant, selected.Selection.VariantId);
        Assert.Equal(next.Selection, selected.Back().Selection);
        Assert.Throws<InvalidOperationException>(() => next.Select(next.Selection with { VariantId = f.Variant }));
        Assert.Throws<InvalidOperationException>(() => next.Select(next.Selection with { Theme = (TokenTheme)42 }));
        Assert.Throws<InvalidOperationException>(() => next.Trigger(f.Child, PreviewEvent.Click));
    }

    [Fact]
    public async Task NestedOverlaysUseActiveNodesAndHistoryAndManualScreenChangesDismissThem()
    {
        var f = new Fixture();
        var document = f.Document with { Scenarios = [
            f.Scenario(f.Screen, f.Node, PreviewEvent.Click, new OpenOverlay(f.Overlay)),
            f.Scenario(f.Overlay, f.OverlayNode, PreviewEvent.Click, new SetDemoValue(f.OverlayNode, "overlay"), new OpenOverlay(f.Other)),
            f.Scenario(f.Other, f.OtherNode, PreviewEvent.Leave, new CloseOverlay()),
            f.Scenario(f.Overlay, f.OverlayNode, PreviewEvent.Leave, new CloseOverlay(), new SetDemoValue(f.Node, "underlying"), new ShowVariant(f.Variant))] };
        var start = (await f.Create(document)).Preview!.Session;
        var first = start.Trigger(f.Node, PreviewEvent.Click);
        Assert.Throws<InvalidOperationException>(() => first.Trigger(f.Node, PreviewEvent.Click));
        var second = first.Trigger(f.OverlayNode, PreviewEvent.Click);
        Assert.Equal(new[] { f.Overlay, f.Other }, second.Overlays);
        Assert.Equal(f.Selection, second.Selection);
        var closed = second.Trigger(f.OtherNode, PreviewEvent.Leave).Trigger(f.OverlayNode, PreviewEvent.Leave);
        Assert.Empty(closed.Overlays);
        Assert.Equal("underlying", closed.Values[f.Node]);
        Assert.Single(closed.Back().Overlays);
        Assert.Equal(2, closed.Back().Back().Overlays.Count);
        Assert.Empty(second.Select(second.Selection with { ScreenId = f.Other, VariantId = null }).Overlays);
        Assert.Equal(f.Selection, second.Reset().Selection);
        Assert.Empty(second.Reset().Values);
        Assert.Empty(second.Reset().Overlays);
        Assert.False(second.RestartFlow().CanGoBack);
    }

    [Fact]
    public async Task ContextualActionsValidateAfterResetAndAcrossMultipleScenarioHandlersAtomically()
    {
        var f = new Fixture();
        var document = f.Document with { Scenarios = [
            f.Scenario(f.Other, f.OtherNode, PreviewEvent.Click, new ResetPreview(), new ShowVariant(f.OtherVariant)),
            f.Scenario(f.Screen, f.Node, PreviewEvent.Click, new Navigate(f.Other)),
            f.Scenario(f.Screen, f.Node, PreviewEvent.Click, new SetDemoValue(f.Node, "wrong screen"))] };
        var start = (await f.Create(document)).Preview!.Session;
        Assert.Throws<InvalidOperationException>(() => start.Trigger(f.Node, PreviewEvent.Click));
        Assert.Equal(f.Selection, start.Selection);
        Assert.Empty(start.Values);
        Assert.False(start.CanGoBack);
        var other = start.Select(start.Selection with { ScreenId = f.Other, VariantId = null });
        Assert.Throws<InvalidOperationException>(() => other.Trigger(f.OtherNode, PreviewEvent.Click));
        Assert.Equal(f.Other, other.Selection.ScreenId);
    }

    [Fact]
    public async Task InvalidReferencesAndActionSequencesAndSelectionsAreRejected()
    {
        var f = new Fixture();
        foreach (var actions in new PreviewAction[][] { [new Navigate(f.Other), new ShowVariant(f.Variant)],
            [new OpenOverlay(f.Other), new SetDemoValue(f.Node, "wrong")], [new SelectDataset(f.Node)], [new Navigate(Guid.NewGuid())] })
            Assert.Equal("INVALID_DOCUMENT", (await f.Create(f.Document with { Scenarios = [f.Scenario(f.Screen, f.Node, PreviewEvent.Click, actions)] })).Code);
        foreach (var selection in new[] { f.Selection with { VariantId = f.OtherVariant }, f.Selection with { DatasetId = f.Node },
            f.Selection with { ScreenId = f.Node }, f.Selection with { Viewport = new(double.NaN, 0) } })
            Assert.Equal("INVALID_PREVIEW", (await f.Create(selection: selection)).Code);
    }

    [Fact]
    public async Task SessionDetachesMutableScenarioListsAndEachSessionHasItsOwnHistory()
    {
        var f = new Fixture(); var actions = new PreviewAction[] { new SetDemoValue(f.Node, "original") };
        var document = f.Document with { Scenarios = [f.Scenario(f.Screen, f.Node, PreviewEvent.Click, actions)] };
        var first = (await f.Create(document)).Preview!.Session;
        var second = (await f.Create(document)).Preview!.Session;
        actions[0] = new SetDemoValue(f.Node, "mutated");
        Assert.Equal("original", first.Trigger(f.Node, PreviewEvent.Click).Values[f.Node]);
        Assert.Empty(second.Values);
        Assert.False(second.CanGoBack);
    }

    [Fact]
    public async Task HistoricalDocumentReadIsUsedInsteadOfLatestDraft()
    {
        var f = new Fixture(); var directory = Path.Combine(Path.GetTempPath(), "figvam-preview-" + Guid.NewGuid());
        try
        {
            var journal = new SqliteDocumentJournal(directory, new Profile());
            await journal.InitializeAsync(f.Document);
            var handler = new DocumentCommandHandler(new EditAuthorization(), journal, new Profile());
            Assert.True((await handler.HandleAsync(new CreateScenarioCommand(f.Document.Id, Guid.NewGuid(),
                f.Scenario(f.Screen, f.Node, PreviewEvent.Click, new SetDemoValue(f.Node, "new revision"))), new("editor"))).Accepted);
            var factory = new DocumentPreviewFactory(new Authorization(), journal, new Profile(), new NoRemoteReader());
            var result = await factory.CreateAsync(f.Document.Id, 0, f.Selection, new("viewer"));
            Assert.Equal("OK", result.Code);
            Assert.Equal(0, result.Preview!.Revision);
            Assert.Empty(result.Preview.Session.Trigger(f.Node, PreviewEvent.Click).Values);
            var latest = (await factory.CreateAsync(f.Document.Id, null, f.Selection, new("viewer"))).Preview!;
            Assert.Equal(1, latest.Revision);
            Assert.Equal("new revision", latest.Session.Trigger(f.Node, PreviewEvent.Click).Values[f.Node]);
            result.Preview.Session.Select(f.Selection with { DatasetId = null }).Reset();
            Assert.Equal(1, (await journal.ReadAsync(f.Document.Id))!.Revision);
            Assert.Equal(JsonSerializer.Serialize(f.Document), JsonSerializer.Serialize((await ((IDocumentStateReader)journal).ReadAsync(f.Document.Id, 0)).State!.Document));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private sealed class EditAuthorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
    }
}
