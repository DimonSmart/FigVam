using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentCommandHistoryTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-history-" + Guid.NewGuid());
    private readonly Guid id = Guid.NewGuid();
    private readonly Guid page = Guid.NewGuid();
    private readonly Guid screen = Guid.NewGuid();
    private readonly DocumentActor alice = new("alice"), bob = new("bob");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind is "container" or "leaf";
        public bool CanContainChildren(string kind) => kind == "container";
    }
    private sealed class Authorization(bool allowed = true) : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken) => ValueTask.FromResult(allowed);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken) => ValueTask.FromResult(allowed);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler(bool allowed = true) => new(new Authorization(allowed), Journal(), new Profile());
    private Task Seed() => Journal().InitializeAsync(new(id, [new(page, [screen])], [new(screen, [], new(800, 600))], []));
    private Task<CommandResult> Undo(DocumentActor? actor = null) => Handler().HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor ?? alice);
    private Task<CommandResult> Redo(DocumentActor? actor = null) => Handler().HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), actor ?? alice);
    private Task<CommandResult> Add(Guid node, Guid? parent = null, DocumentActor? actor = null) => Handler().HandleAsync(new AddNodeCommand(id, Guid.NewGuid(), parent ?? screen, node, "container"), actor ?? alice);
    private async Task<DocumentStructure> Document() => (await Journal().ReadAsync(id))!.Document;

    [Fact]
    public async Task DocumentRenameIsDurableIdempotentAndSafelyCompensated()
    {
        await Seed();
        var command = new RenameDocumentCommand(id, Guid.NewGuid(), "Design");
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, alice)).Code);
        Assert.Equal("INVALID_DOCUMENT_NAME", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Name = "  " }, alice)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(id))!.Revision);
        var first = await Handler().HandleAsync(command, alice);
        Assert.True(first.Accepted);
        Assert.Equal(first, await Handler().HandleAsync(command with { Name = "ignored" }, alice));
        Assert.Equal("Design", (await Document()).Name);
        Assert.Equal("Document", (await Journal().ReadAsync(id, 0)).State!.Document.Name);
        var query = new DocumentStructureQueries(new Authorization(), Journal());
        Assert.Equal("Design", Assert.Single((await query.QueryAsync(id, new("document"), alice)).Response!.Items).Name);
        Assert.Equal("Design", Assert.IsType<DocumentRenamed>(Assert.Single((await Journal().ReadEventsAsync(id, 0)).Events!).Payload).Name);
        Assert.True((await Undo()).Accepted);
        Assert.Equal("Document", (await Document()).Name);
        Assert.True((await Redo()).Accepted);
        Assert.Equal("Design", (await Document()).Name);
        Assert.True((await Handler().HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Other"), bob)).Accepted);
        var revision = (await Journal().ReadAsync(id))!.Revision;
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Undo()).Code);
        Assert.Equal(revision, (await Journal().ReadAsync(id))!.Revision);
    }

    [Fact]
    public async Task PageRenameIsAuthorizedDurableIdempotentAndGuarded()
    {
        await Seed();
        var command = new RenamePageCommand(id, Guid.NewGuid(), page, "Home");
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, alice)).Code);
        Assert.Equal("INVALID_PAGE", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), Name = "  " }, alice)).Code);
        Assert.Equal("PAGE_NOT_FOUND", (await Handler().HandleAsync(command with { CommandId = Guid.NewGuid(), PageId = Guid.NewGuid() }, alice)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(id))!.Revision);
        var first = await Handler().HandleAsync(command, alice);
        Assert.True(first.Accepted);
        Assert.Equal(first, await Handler().HandleAsync(command with { Name = "ignored" }, alice));
        Assert.Equal("Home", Assert.Single((await Journal().ReadAsync(id))!.Document.Pages).Name);
        Assert.Equal("Page", Assert.Single((await Journal().ReadAsync(id, 0)).State!.Document.Pages).Name);
        var query = new DocumentStructureQueries(new Authorization(), Journal());
        Assert.Equal("Home", Assert.Single((await query.QueryAsync(id, new("page", page), alice)).Response!.Items).Name);
        Assert.Equal("Page", Assert.Single((await query.QueryAsync(id, new("page", page, Revision: 0), alice)).Response!.Items).Name);
        var events = await Journal().ReadEventsAsync(id, 0);
        Assert.Equal("Home", Assert.IsType<PageRenamed>(Assert.Single(events.Events!).Payload).Name);
        Assert.True((await Undo()).Accepted);
        Assert.Equal("Page", Assert.Single((await Document()).Pages).Name);
        Assert.True((await Redo()).Accepted);
        Assert.Equal("Home", Assert.Single((await Document()).Pages).Name);
        Assert.True((await Handler().HandleAsync(new RenamePageCommand(id, Guid.NewGuid(), page, "Other"), bob)).Accepted);
        var revision = (await Journal().ReadAsync(id))!.Revision;
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Undo()).Code);
        Assert.Equal(revision, (await Journal().ReadAsync(id))!.Revision);
    }

    [Fact]
    public async Task IndependentUserHistoriesPreserveOtherUsersPagesAndDeliverCompensationEvents()
    {
        await Seed();
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), a), alice);
        await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), b), bob);
        Assert.True((await Undo()).Accepted);
        Assert.Contains((await Document()).Pages, p => p.Id == b);
        Assert.DoesNotContain((await Document()).Pages, p => p.Id == a);
        Assert.True((await Redo()).Accepted);
        Assert.True((await Undo(bob)).Accepted);
        var history = await new DocumentCommandHistoryReader(new Authorization(), Journal()).ReadAsync(id, alice);
        Assert.All(history.Entries!, entry => Assert.Equal("alice", entry.Result.ActorId));
        var events = await Journal().ReadEventsAsync(id, 0);
        Assert.Equal(new[] { "ADD_PAGE", "ADD_PAGE", "UNDO", "REDO", "UNDO" }, events.Events!.Select(e => e.Type));
        Assert.IsType<HistoryCompensated>(events.Events![2].Payload);
    }

    [Theory]
    [InlineData("page")]
    [InlineData("screen")]
    [InlineData("node")]
    [InlineData("delete")]
    [InlineData("move")]
    public async Task StructuralCommandsRoundTripAcrossNewJournalInstances(string operation)
    {
        await Seed();
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        if (operation is "delete" or "move") { await Add(a); await Add(b, a); }
        var before = JsonSerializer.Serialize(await Document());
        var handler = Handler();
        var accepted = operation switch
        {
            "page" => await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), a), alice),
            "screen" => await handler.HandleAsync(new AddScreenCommand(id, Guid.NewGuid(), page, a, new(800, 600)), alice),
            "node" => await Add(a),
            "delete" => await handler.HandleAsync(new DeleteNodeCommand(id, Guid.NewGuid(), a), alice),
            _ => await handler.HandleAsync(new MoveNodeCommand(id, Guid.NewGuid(), b, a, screen, 0), alice)
        };
        Assert.True(accepted.Accepted);
        var after = JsonSerializer.Serialize(await Document());
        Assert.True((await Undo()).Accepted);
        Assert.Equal(before, JsonSerializer.Serialize(await Document()));
        Assert.True((await Redo()).Accepted);
        Assert.Equal(after, JsonSerializer.Serialize(await Document()));
    }

    [Fact]
    public async Task ForeignDescendantEditRejectsUndoWithoutRevisionOrHistoryMutationAndRetriesAreStable()
    {
        await Seed();
        var node = Guid.NewGuid(); await Add(node);
        await Add(Guid.NewGuid(), node, bob);
        var before = await Journal().ReadAsync(id);
        var command = new UndoDocumentCommand(id, Guid.NewGuid());
        var rejected = await Handler().HandleAsync(command, alice);
        Assert.Equal("UNDO_NOT_APPLICABLE", rejected.Code);
        Assert.False(string.IsNullOrWhiteSpace(rejected.Explanation));
        Assert.Equal(before!.Revision, (await Journal().ReadAsync(id))!.Revision);
        Assert.Equal(JsonSerializer.Serialize(before), JsonSerializer.Serialize(await Journal().ReadAsync(id)));
        Assert.Equal(rejected, await Handler().HandleAsync(command, alice));
        Assert.Equal("ACTIVE", Assert.Single((await Journal().ReadHistoryAsync(id, alice.Id)).Entries!).Status);
    }

    [Fact]
    public async Task RedoChecksForeignChangesAndNewOwnActionDiscardsRedoChain()
    {
        await Seed(); var node = Guid.NewGuid();
        await Add(node); await Undo();
        await Add(Guid.NewGuid(), actor: bob);
        Assert.Contains((await Journal().ReadHistoryAsync(id, alice.Id)).Entries!, e => e.Status == "DISCARDED");
        var revision = (await Journal().ReadAsync(id))!.Revision;
        Assert.Equal("REDO_NOT_APPLICABLE", (await Redo()).Code);
        Assert.Equal(revision, (await Journal().ReadAsync(id))!.Revision);
        await Add(Guid.NewGuid());
        Assert.Equal("REDO_NOT_APPLICABLE", (await Redo()).Code);
        Assert.Contains((await Journal().ReadHistoryAsync(id, alice.Id)).Entries!, e => e.Status == "DISCARDED");
    }

    [Fact]
    public async Task SaveIsImmutableAndDoesNotConsumeUndoOrClearRedoAndRestoreIsCompensatedSafely()
    {
        await Seed(); var node = Guid.NewGuid(); await Add(node);
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "version"), alice);
        await Undo();
        var emptySave = await Handler().HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), alice);
        Assert.True((await Redo()).Accepted);
        await Handler().HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), emptySave.VersionId!.Value), alice);
        Assert.Empty((await Document()).Nodes);
        Assert.True((await Undo()).Accepted);
        Assert.Single((await Document()).Nodes);
        Assert.True((await Redo()).Accepted);
        Assert.Empty((await Document()).Nodes);
        Assert.Single((await Journal().ReadVersionAsync(id, saved.VersionId!.Value)).Version!.Snapshot.Document.Nodes);
        Assert.Equal(2, (await Journal().ListVersionsAsync(id, 100, null)).Versions!.Count);
    }

    [Fact]
    public async Task DuplicateUndoRedoAndAuthorizationRemainStableAfterSnapshotRecovery()
    {
        await Seed();
        for (var i = 0; i < 33; i++) await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), alice);
        var undo = new UndoDocumentCommand(id, Guid.NewGuid());
        var result = await Handler().HandleAsync(undo, alice);
        Assert.Equal(result, await Handler().HandleAsync(undo, alice));
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(undo, alice)).Code);
        var redo = new RedoDocumentCommand(id, Guid.NewGuid());
        var redone = await Handler().HandleAsync(redo, alice);
        Assert.Equal(redone, await Handler().HandleAsync(redo, alice));
        Assert.Equal(35, (await Journal().ReadAsync(id))!.Revision);
        Assert.Equal(34, (await Document()).Pages.Count);
        Assert.Equal("FORBIDDEN", (await new DocumentCommandHistoryReader(new Authorization(false), Journal()).ReadAsync(id, alice)).Code);
    }

    [Fact]
    public async Task MultipleUndoRedoStepsUseStackOrderAndForeignRestoreConflictIsRejected()
    {
        await Seed();
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), alice);
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        await Add(a); await Add(b, a);
        Assert.True((await Undo()).Accepted);
        Assert.True((await Undo()).Accepted);
        Assert.Empty((await Document()).Nodes);
        Assert.True((await Redo()).Accepted);
        Assert.True((await Redo()).Accepted);
        Assert.Equal(2, (await Document()).Nodes.Count);
        await Handler().HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), saved.VersionId!.Value), alice);
        await Add(a, actor: bob);
        var before = JsonSerializer.Serialize(await Journal().ReadAsync(id));
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Undo()).Code);
        Assert.Equal(before, JsonSerializer.Serialize(await Journal().ReadAsync(id)));
    }

    [Fact]
    public async Task RestoreCompensationPreservesExactCollectionAndChildOrder()
    {
        await Seed(); var a = Guid.NewGuid(); var b = Guid.NewGuid();
        await Add(a); await Add(b);
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), alice);
        await Handler().HandleAsync(new DeleteNodeCommand(id, Guid.NewGuid(), a), alice);
        await Add(a);
        var before = JsonSerializer.Serialize(await Document());
        await Handler().HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), saved.VersionId!.Value), alice);
        var after = JsonSerializer.Serialize(await Document());
        Assert.True((await Undo()).Accepted);
        Assert.Equal(before, JsonSerializer.Serialize(await Document()));
        Assert.True((await Redo()).Accepted);
        Assert.Equal(after, JsonSerializer.Serialize(await Document()));
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
