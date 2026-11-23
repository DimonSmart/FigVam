using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class PageDeletionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-page-delete-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), page = Guid.NewGuid(), screen = Guid.NewGuid(), root = Guid.NewGuid(), child = Guid.NewGuid();
    private readonly DocumentActor owner = new("owner"), editor = new("editor");
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => true;
        public bool SupportsPreviewAction(PreviewAction action) => true;
        public bool SupportsDemoValue(string kind) => true;
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Access(), Journal(), new Profile());
    private DocumentStructure Initial() => new(doc, [new(page, [screen]) { Name = "Design" }],
        [new(screen, [root], new(320, 480)) { Variants = [new(Guid.NewGuid(), "Alternate", [])] }],
        [new(root, "test", [child]), new(child, "test", [])]);
    private DeletePageCommand Delete(long revision = 0) => new(doc, Guid.NewGuid(), page, revision);
    private async Task<string> Current() => JsonSerializer.Serialize(await Journal().ReadAsync(doc));

    [Fact]
    public async Task DeletionRecoversEventsRevisionsSavedVersionsAndSafeHistory()
    {
        await Journal().InitializeAsync(Initial());
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid()), owner);
        var command = Delete(1);
        var result = await Handler().HandleAsync(command, owner);
        Assert.True(result.Accepted);
        Assert.Equal(new[] { page, screen, root, child }.Order(), result.AffectedIds!.Order());
        Assert.Equal(result, await Handler().HandleAsync(command with { PageId = Guid.Empty, ExpectedRevision = -1 }, owner));
        var current = (await Journal().ReadAsync(doc))!;
        Assert.Equal(2, current.Revision); Assert.Empty(current.Document.Pages); Assert.Empty(current.Document.Screens); Assert.Empty(current.Document.Nodes);
        var old = (await Journal().ReadAsync(doc, 1)).State!;
        Assert.Equal("Design", Assert.Single(old.Document.Pages).Name); Assert.Equal(2, old.Document.Nodes.Count);
        var change = Assert.Single((await Journal().ReadEventsAsync(doc, 1)).Events!);
        Assert.IsType<PageDeleted>(change.Payload); Assert.Equal("DELETE_PAGE", change.Type); Assert.Equal(command.CommandId, change.CommandId); Assert.Equal("owner", change.ActorId);
        Assert.Equal("DELETE_PAGE", (await new DocumentCommandHistoryReader(new Access(), Journal()).ReadAsync(doc, owner)).Entries!.First(e => e.Result.CommandId == command.CommandId).Type);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(old.Document), JsonSerializer.Serialize((await Journal().ReadAsync(doc))!.Document));
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Pages);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), saved.VersionId!.Value), owner)).Accepted);
        Assert.Equal(2, (await Journal().ReadAsync(doc))!.Document.Nodes.Count);
        for (var i = 0; i < 35; i++) Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), editor)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc, 2)).State!.Document.Pages);
        Assert.Equal("Design", (await Journal().ReadAsync(doc))!.Document.Pages[0].Name);
    }

    [Fact]
    public async Task ContainedInstancesAreDeletedWithoutRemovingTheirExternalDefinition()
    {
        var definition = Guid.NewGuid(); var definitionRoot = Guid.NewGuid(); var definitionScreen = Guid.NewGuid();
        var document = Initial();
        document = document with
        {
            Screens = [.. document.Screens, new(definitionScreen, [definitionRoot], new(100, 100))],
            Nodes = [.. document.Nodes, new(definitionRoot, "test", [])],
            ComponentDefinitions = [new(definition, "External", "", definitionRoot, [], [], [])],
            ComponentInstances = [new(root, definition, null, new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>())]
        };
        await Journal().InitializeAsync(document);
        Assert.True((await Handler().HandleAsync(Delete(), owner)).Accepted);
        var current = (await Journal().ReadAsync(doc))!.Document;
        Assert.Empty(current.ComponentInstances); Assert.Single(current.ComponentDefinitions);
        Assert.Equal(definitionRoot, Assert.Single(current.Nodes).Id);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Single((await Journal().ReadAsync(doc))!.Document.ComponentInstances);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.ComponentInstances);
    }

    [Fact]
    public async Task InvalidUnauthorizedAndConcurrentCommandsPreserveState()
    {
        await Journal().InitializeAsync(Initial()); var before = await Current();
        foreach (var actor in new[] { "viewer", "outsider" }) Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Delete(), new(actor))).Code);
        Assert.Equal("INVALID_ID", (await Handler().HandleAsync(Delete() with { PageId = Guid.Empty }, owner)).Code);
        Assert.Equal("PAGE_NOT_FOUND", (await Handler().HandleAsync(Delete() with { PageId = Guid.NewGuid() }, owner)).Code);
        Assert.Equal("INVALID_REVISION", (await Handler().HandleAsync(Delete(-1), owner)).Code);
        Assert.Equal("REVISION_CONFLICT", (await Handler().HandleAsync(Delete(1), owner)).Code);
        Assert.Equal(before, await Current());
        Assert.True((await Handler().HandleAsync(Delete(), owner)).Accepted);
        Assert.Equal("PAGE_NOT_FOUND", (await Handler().HandleAsync(Delete(1), editor)).Code);
        Assert.Equal("FORBIDDEN", (await new DocumentStructureQueries(new Access(), Journal(), new Profile()).QueryAsync(doc, new("pages", Revision: 0), new("outsider"))).Code);
    }

    [Theory]
    [InlineData("page")]
    [InlineData("scenario")]
    [InlineData("component")]
    public async Task RetainedReferencesBlockDeletionWithoutRevisionChange(string reference)
    {
        var document = Initial();
        document = reference switch
        {
            "page" => document with { Pages = [.. document.Pages, new(Guid.NewGuid(), [screen])] },
            "scenario" => document with { Scenarios = [new(Guid.NewGuid(), screen, child, PreviewEvent.Click, [new Navigate(screen)])] },
            _ => document with { ComponentDefinitions = [new(Guid.NewGuid(), "Component", "", root, [], [], [])] }
        };
        await Journal().InitializeAsync(document); var before = await Current(); var command = Delete();
        var denied = await Handler().HandleAsync(command, owner);
        Assert.Equal("PAGE_IN_USE", denied.Code); Assert.NotEmpty(denied.Explanation!);
        Assert.Equal(before, await Current());
        Assert.Equal(denied, await Handler().HandleAsync(command with { PageId = Guid.NewGuid() }, owner));
        Assert.Empty((await Journal().ReadEventsAsync(doc, 0)).Events!);
    }

    [Fact]
    public async Task UndoRejectsIdReuseAndRedoRejectsAnotherActorsEdit()
    {
        await Journal().InitializeAsync(Initial());
        Assert.True((await Handler().HandleAsync(Delete(), owner)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), page), editor)).Accepted);
        var before = await Current();
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
        Assert.Equal(before, await Current());
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.True((await Handler().HandleAsync(new RenamePageCommand(doc, Guid.NewGuid(), page, "Another edit"), editor)).Accepted);
        before = await Current();
        Assert.Equal("REDO_NOT_APPLICABLE", (await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
        Assert.Equal(before, await Current());
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
