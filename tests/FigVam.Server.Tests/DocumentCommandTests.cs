using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentCommandTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-journal-" + Guid.NewGuid());
    private readonly Guid documentId = Guid.NewGuid();
    private readonly DocumentActor actor = new("server-authenticated-editor");
    private sealed class Profile : INodeProfile
    {
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind is "container" or "leaf";
        public bool CanContainChildren(string kind) => kind == "container";
    }
    private sealed class Authorization(bool allowed) : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(allowed);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(allowed);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler(SqliteDocumentJournal journal, bool allowed = true)
        => new(new Authorization(allowed), journal, new Profile());
    private Task Seed(SqliteDocumentJournal journal, Guid? id = null)
        => journal.InitializeAsync(new(id ?? documentId, [], [], []));
    private AddPageCommand Command() => new(documentId, Guid.NewGuid(), Guid.NewGuid());

    [Fact]
    public async Task ViewerCannotMutateOrReadOriginalResult()
    {
        var journal = Journal();
        await Seed(journal);
        var command = Command();
        Assert.Equal("FORBIDDEN", (await Handler(journal, false).HandleAsync(command, actor)).Code);
        Assert.Equal(0, (await journal.ReadAsync(documentId))!.Revision);
        Assert.Empty((await journal.ReadAsync(documentId))!.Document.Pages);
        Assert.True((await Handler(journal).HandleAsync(command, actor)).Accepted);
        Assert.Equal("FORBIDDEN", (await Handler(journal, false).HandleAsync(command, actor)).Code);
    }

    [Fact]
    public async Task IndependentInstancesSerializeConcurrentCommandsWithoutLostUpdates()
    {
        await Seed(Journal());
        var handlers = new[] { Handler(Journal()), Handler(Journal()) };
        var results = await Task.WhenAll(Enumerable.Range(0, 40)
            .Select(i => handlers[i % 2].HandleAsync(Command(), actor)));
        Assert.All(results, result => Assert.True(result.Accepted));
        Assert.Equal(Enumerable.Range(1, 40).Select(i => (long?)i), results.Select(r => r.Revision).Order());
        var state = await Journal().ReadAsync(documentId);
        Assert.Equal(40, state!.Revision);
        Assert.Equal(40, state.Document.Pages.Select(p => p.Id).Distinct().Count());
    }

    [Fact]
    public async Task ConcurrentRetriesReturnExactlyOriginalResultEvenWithDifferentPayload()
    {
        await Seed(Journal());
        var command = Command();
        var original = await Handler(Journal()).HandleAsync(command, actor);
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            Handler(Journal()).HandleAsync(command with { PageId = Guid.NewGuid() }, actor)));
        Assert.All(results, result => Assert.Equal(original, result));
        var state = await Journal().ReadAsync(documentId);
        Assert.Equal(1, state!.Revision);
        Assert.Equal(command.PageId, Assert.Single(state.Document.Pages).Id);
    }

    [Fact]
    public async Task SimultaneousFirstAttemptsOfSameCommandAreAppliedOnce()
    {
        await Seed(Journal());
        var command = Command();
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ =>
            Handler(Journal()).HandleAsync(command, actor)));
        Assert.All(results, result => Assert.Equal(results[0], result));
        var state = await Journal().ReadAsync(documentId);
        Assert.Equal(1, state!.Revision);
        Assert.Single(state.Document.Pages);
    }

    [Fact]
    public async Task DuplicatePageAndTechnicalIdsAreRejectedWithoutRevisionChange()
    {
        var journal = Journal();
        await Seed(journal);
        var handler = Handler(journal);
        var command = Command();
        await handler.HandleAsync(command, actor);
        var rejected = await handler.HandleAsync(command with { CommandId = Guid.NewGuid() }, actor);
        Assert.Equal("DUPLICATE_ID", rejected.Code);
        var rejectedCommand = command with { CommandId = rejected.CommandId, PageId = Guid.NewGuid() };
        Assert.Equal(rejected, await Handler(Journal()).HandleAsync(rejectedCommand, actor));
        Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(Command() with { PageId = documentId }, actor)).Code);
        Assert.Equal(1, (await journal.ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task RestartRecoversSnapshotAndFollowingEventsAndLostAcknowledgment()
    {
        var journal = Journal();
        await Seed(journal);
        var commands = Enumerable.Range(0, 35).Select(_ => Command()).ToArray();
        CommandResult? original = null;
        foreach (var command in commands) original = await Handler(journal).HandleAsync(command, actor);
        // Every operation closed its SQLite connection; a fresh store has no in-memory document cache.
        var restarted = Journal();
        var state = await restarted.ReadAsync(documentId);
        Assert.Equal(35, state!.Revision);
        Assert.Equal(commands.Select(c => c.PageId), state.Document.Pages.Select(p => p.Id));
        Assert.Equal(original, await Handler(restarted).HandleAsync(commands[^1], actor));
    }

    [Fact]
    public async Task UncommittedFailureDoesNotLeaveStateOrIdempotencyResult()
    {
        var journal = Journal();
        await Seed(journal);
        var command = Command();
        await Assert.ThrowsAsync<InvalidOperationException>(() => journal.ExecuteAsync(documentId, command.CommandId,
            (_, _, _) => throw new InvalidOperationException("Simulated failure before commit")));
        Assert.Equal(0, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.True((await Handler(Journal()).HandleAsync(command, actor)).Accepted);
    }

    [Fact]
    public async Task BlockedDocumentDoesNotBlockAnotherDocument()
    {
        var journal = Journal();
        await Seed(journal);
        var second = Guid.NewGuid();
        await Seed(journal, second);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var blockedCommandId = Guid.NewGuid();
        var blocked = journal.ExecuteAsync(documentId, blockedCommandId, (_, _, _) =>
        {
            entered.SetResult();
            if (!release.Wait(TimeSpan.FromSeconds(15))) throw new TimeoutException();
            return new(new(documentId, blockedCommandId, "TEST_REJECTED", null, actor.Id, null, DateTimeOffset.UtcNow), null);
        });
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var result = await Handler(Journal()).HandleAsync(Command() with { DocumentId = second }, actor)
                .WaitAsync(TimeSpan.FromSeconds(10));
            Assert.True(result.Accepted);
            Assert.False(blocked.IsCompleted);
        }
        finally { release.Set(); }
        await blocked;
    }

    [Fact]
    public async Task ScreenCreationValidatesInputsAndLeavesRejectedStateUnchanged()
    {
        var journal = Journal();
        await Seed(journal);
        var handler = Handler(journal);
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        Assert.Equal("FORBIDDEN", (await Handler(journal, false).HandleAsync(screen, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(screen with { ScreenId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(screen with { PageId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(screen with { CommandId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(screen with { DocumentId = Guid.Empty }, actor)).Code);
        Assert.Equal("PAGE_NOT_FOUND", (await handler.HandleAsync(screen with { CommandId = Guid.NewGuid(), PageId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await handler.HandleAsync(screen with { DocumentId = Guid.NewGuid(), CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(screen with { CommandId = Guid.NewGuid(), ScreenId = page.PageId }, actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(screen with { CommandId = Guid.NewGuid(), ScreenId = documentId }, actor)).Code);
        var rejected = await handler.HandleAsync(screen with { CommandId = Guid.NewGuid(), PageId = Guid.NewGuid() }, actor);
        Assert.Equal(rejected, await Handler(Journal()).HandleAsync(screen with { CommandId = rejected.CommandId }, actor));
        Assert.Equal(1, (await journal.ReadAsync(documentId))!.Revision);
        var result = await handler.HandleAsync(screen, actor);
        Assert.True(result.Accepted);
        Assert.Equal(2, result.Revision);
        Assert.Equal(screen.ScreenId, result.ScreenId);
        var state = (await journal.ReadAsync(documentId))!;
        Assert.Equal(screen.ScreenId, Assert.Single(Assert.Single(state.Document.Pages).ScreenIds));
        Assert.Empty(Assert.Single(state.Document.Screens).ChildIds);
        Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(screen with { CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal(2, (await journal.ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task ConcurrentScreenCommandsAndRetriesAreSerialized()
    {
        await Seed(Journal());
        var page = Command();
        await Handler(Journal()).HandleAsync(page, actor);
        var commands = Enumerable.Range(0, 20).Select(_ =>
            new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid())).ToArray();
        var results = await Task.WhenAll(commands.Select(c => Handler(Journal()).HandleAsync(c, actor)));
        Assert.Equal(Enumerable.Range(2, 20).Select(i => (long?)i), results.Select(r => r.Revision).Order());
        var retry = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Handler(Journal()).HandleAsync(commands[0] with { ScreenId = Guid.NewGuid() }, actor)));
        Assert.All(retry, result => Assert.Equal(results[0], result));
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(21, state.Revision);
        Assert.Equal(20, state.Document.Screens.Count);
        Assert.Equal(20, Assert.Single(state.Document.Pages).ScreenIds.Distinct().Count());
    }

    [Fact]
    public async Task MixedEventsRecoverAcrossSnapshotAndRestart()
    {
        await Seed(Journal());
        var pages = new List<AddPageCommand>();
        var screens = new List<AddScreenCommand>();
        CommandResult? last = null;
        for (var i = 0; i < 18; i++)
        {
            var page = Command();
            pages.Add(page);
            await Handler(Journal()).HandleAsync(page, actor);
            var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
            screens.Add(screen);
            last = await Handler(Journal()).HandleAsync(screen, actor);
        }
        var restarted = Journal();
        var state = (await restarted.ReadAsync(documentId))!;
        Assert.Equal(36, state.Revision);
        Assert.Equal(pages.Select(p => p.PageId), state.Document.Pages.Select(p => p.Id));
        Assert.Equal(screens.Select(s => s.ScreenId), state.Document.Screens.Select(s => s.Id));
        Assert.Equal(screens.Select(s => s.ScreenId), state.Document.Pages.Select(p => Assert.Single(p.ScreenIds)));
        Assert.Equal(last, await Handler(restarted).HandleAsync(screens[^1], actor));
    }

    [Fact]
    public async Task NodesValidateParentsProfileAndIdsWithoutChangingRejectedState()
    {
        var journal = Journal();
        await Seed(journal);
        var handler = Handler(journal);
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        await handler.HandleAsync(screen, actor);
        var node = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        Assert.Equal("FORBIDDEN", (await Handler(journal, false).HandleAsync(node, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(node with { NodeId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(node with { ParentId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(node with { DocumentId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(node with { CommandId = Guid.Empty }, actor)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await handler.HandleAsync(node with { DocumentId = Guid.NewGuid(), CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("PARENT_NOT_FOUND", (await handler.HandleAsync(node with { ParentId = Guid.NewGuid(), CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("INVALID_PARENT_TYPE", (await handler.HandleAsync(node with { ParentId = page.PageId, CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("DUPLICATE_ID", (await handler.HandleAsync(node with { NodeId = screen.ScreenId, CommandId = Guid.NewGuid() }, actor)).Code);
        var rejected = await handler.HandleAsync(node with { Kind = "unverified", CommandId = Guid.NewGuid() }, actor);
        Assert.Equal("UNSUPPORTED_NODE_KIND", rejected.Code);
        Assert.Equal(rejected, await Handler(Journal()).HandleAsync(node with { CommandId = rejected.CommandId }, actor));
        Assert.Equal(2, (await journal.ReadAsync(documentId))!.Revision);
        var accepted = await handler.HandleAsync(node, actor);
        Assert.Equal(3, accepted.Revision);
        Assert.Equal(node.NodeId, accepted.NodeId);
        var leaf = new AddNodeCommand(documentId, Guid.NewGuid(), node.NodeId, Guid.NewGuid(), "leaf");
        Assert.True((await handler.HandleAsync(leaf, actor)).Accepted);
        Assert.Equal("CHILDREN_NOT_ALLOWED", (await handler.HandleAsync(leaf with { ParentId = leaf.NodeId, NodeId = Guid.NewGuid(), CommandId = Guid.NewGuid() }, actor)).Code);
        var second = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "leaf");
        var last = await handler.HandleAsync(second, actor);
        var restarted = Journal();
        var state = (await restarted.ReadAsync(documentId))!;
        Assert.Equal(5, state.Revision);
        Assert.Equal(new[] { node.NodeId, second.NodeId }, Assert.Single(state.Document.Screens).ChildIds);
        Assert.Equal(leaf.NodeId, Assert.Single(state.Document.Nodes.Single(n => n.Id == node.NodeId).ChildIds));
        Assert.Empty(DocumentStructureValidator.Validate(state.Document, new Profile()));
        Assert.Equal(last, await Handler(restarted).HandleAsync(second with { NodeId = Guid.NewGuid() }, actor));
    }

    [Fact]
    public async Task MixedNodeEventsRecoverAfterSnapshot()
    {
        await Seed(Journal());
        var handler = Handler(Journal());
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        await handler.HandleAsync(screen, actor);
        var nodes = Enumerable.Range(0, 35).Select(_ => new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "leaf")).ToArray();
        foreach (var node in nodes) Assert.True((await handler.HandleAsync(node, actor)).Accepted);
        var recovered = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(37, recovered.Revision);
        Assert.Equal(nodes.Select(n => n.NodeId), Assert.Single(recovered.Document.Screens).ChildIds);
        Assert.Equal(nodes.Select(n => n.NodeId), recovered.Document.Nodes.Select(n => n.Id));
    }

    [Fact]
    public async Task DeleteNodeRemovesLeafAndSubtreeAndRejectsInvalidCommands()
    {
        await Seed(Journal());
        var handler = Handler(Journal());
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        await handler.HandleAsync(screen, actor);
        var root = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        var child = new AddNodeCommand(documentId, Guid.NewGuid(), root.NodeId, Guid.NewGuid(), "container");
        var leaf = new AddNodeCommand(documentId, Guid.NewGuid(), child.NodeId, Guid.NewGuid(), "leaf");
        var sibling = new AddNodeCommand(documentId, Guid.NewGuid(), root.NodeId, Guid.NewGuid(), "leaf");
        foreach (var node in new[] { root, child, leaf, sibling })
            Assert.True((await handler.HandleAsync(node, actor)).Accepted);
        var deleteLeaf = new DeleteNodeCommand(documentId, Guid.NewGuid(), leaf.NodeId);
        Assert.Equal("FORBIDDEN", (await Handler(Journal(), false).HandleAsync(deleteLeaf, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(deleteLeaf with { DocumentId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(deleteLeaf with { CommandId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(deleteLeaf with { NodeId = Guid.Empty }, actor)).Code);
        var missing = deleteLeaf with { CommandId = Guid.NewGuid(), NodeId = Guid.NewGuid() };
        var rejected = await handler.HandleAsync(missing, actor);
        Assert.Equal("NODE_NOT_FOUND", rejected.Code);
        Assert.Equal(rejected, await Handler(Journal()).HandleAsync(missing with { NodeId = leaf.NodeId }, actor));
        Assert.Equal(6, (await Journal().ReadAsync(documentId))!.Revision);
        var deleted = await handler.HandleAsync(deleteLeaf, actor);
        Assert.Equal(7, deleted.Revision);
        Assert.Equal(deleted, await Handler(Journal()).HandleAsync(deleteLeaf with { NodeId = sibling.NodeId }, actor));
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Empty(state.Document.Nodes.Single(n => n.Id == child.NodeId).ChildIds);
        Assert.DoesNotContain(state.Document.Nodes, n => n.Id == leaf.NodeId);
        var deleteRoot = new DeleteNodeCommand(documentId, Guid.NewGuid(), root.NodeId);
        Assert.Equal(8, (await handler.HandleAsync(deleteRoot, actor)).Revision);
        state = (await Journal().ReadAsync(documentId))!;
        Assert.Empty(state.Document.Nodes);
        Assert.Empty(Assert.Single(state.Document.Screens).ChildIds);
        Assert.Empty(DocumentStructureValidator.Validate(state.Document, new Profile()));
        Assert.Equal("NODE_NOT_FOUND", (await handler.HandleAsync(deleteRoot with { CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal(8, (await Journal().ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task DeletionReplaysWithMixedEventsAfterSnapshot()
    {
        await Seed(Journal());
        var handler = Handler(Journal());
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        await handler.HandleAsync(screen, actor);
        for (var i = 0; i < 30; i++)
            await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "leaf"), actor);
        var root = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        var child = new AddNodeCommand(documentId, Guid.NewGuid(), root.NodeId, Guid.NewGuid(), "leaf");
        await handler.HandleAsync(root, actor);
        await handler.HandleAsync(child, actor);
        var delete = new DeleteNodeCommand(documentId, Guid.NewGuid(), root.NodeId);
        var result = await handler.HandleAsync(delete, actor);
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(35, state.Revision);
        Assert.Equal(30, state.Document.Nodes.Count);
        Assert.Equal(30, Assert.Single(state.Document.Screens).ChildIds.Count);
        Assert.Empty(DocumentStructureValidator.Validate(state.Document, new Profile()));
        Assert.Equal(result, await Handler(Journal()).HandleAsync(delete, actor));
    }

    [Fact]
    public async Task MoveValidatesContextParentsCyclesAndRecoversAcrossSnapshot()
    {
        await Seed(Journal());
        var handler = Handler(Journal());
        var page = Command();
        await handler.HandleAsync(page, actor);
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid());
        await handler.HandleAsync(screen, actor);
        var a = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        var b = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        var leaf = new AddNodeCommand(documentId, Guid.NewGuid(), a.NodeId, Guid.NewGuid(), "leaf");
        foreach (var n in new[] { a, b, leaf }) await handler.HandleAsync(n, actor);
        var move = new MoveNodeCommand(documentId, Guid.NewGuid(), leaf.NodeId, a.NodeId, b.NodeId, 0);
        Assert.Equal("FORBIDDEN", (await Handler(Journal(), false).HandleAsync(move, actor)).Code);
        Assert.Equal("INVALID_ID", (await handler.HandleAsync(move with { ExpectedParentId = Guid.Empty }, actor)).Code);
        Assert.Equal("INVALID_PARENT_TYPE", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), TargetParentId = page.PageId }, actor)).Code);
        Assert.Equal("PARENT_NOT_FOUND", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), TargetParentId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal("INVALID_NODE_TYPE", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), NodeId = screen.ScreenId }, actor)).Code);
        Assert.Equal("INVALID_POSITION", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), Position = 1 }, actor)).Code);
        Assert.Equal("CHILDREN_NOT_ALLOWED", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), NodeId = a.NodeId, ExpectedParentId = screen.ScreenId, TargetParentId = leaf.NodeId }, actor)).Code);
        Assert.Equal("CYCLE_NOT_ALLOWED", (await handler.HandleAsync(move with { CommandId = Guid.NewGuid(), NodeId = a.NodeId, ExpectedParentId = screen.ScreenId, TargetParentId = a.NodeId }, actor)).Code);
        Assert.Equal(5, (await Journal().ReadAsync(documentId))!.Revision);
        var accepted = await handler.HandleAsync(move, actor);
        Assert.Equal(6, accepted.Revision);
        Assert.Equal(accepted, await Handler(Journal()).HandleAsync(move with { TargetParentId = a.NodeId }, actor));
        var stale = move with { CommandId = Guid.NewGuid() };
        Assert.Equal("INVALID_LAYOUT_CONTEXT", (await handler.HandleAsync(stale, actor)).Code);
        var reorder = new MoveNodeCommand(documentId, Guid.NewGuid(), b.NodeId, screen.ScreenId, screen.ScreenId, 0);
        Assert.True((await handler.HandleAsync(reorder, actor)).Accepted);
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(new[] { b.NodeId, a.NodeId }, Assert.Single(state.Document.Screens).ChildIds);
        Assert.Equal(leaf.NodeId, Assert.Single(state.Document.Nodes.Single(n => n.Id == b.NodeId).ChildIds));
        for (var i = 0; i < 25; i++) await handler.HandleAsync(Command(), actor);
        var moveAfterSnapshot = new MoveNodeCommand(documentId, Guid.NewGuid(), leaf.NodeId, b.NodeId, a.NodeId, 0);
        Assert.True((await handler.HandleAsync(moveAfterSnapshot, actor)).Accepted);
        state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(33, state.Revision);
        Assert.Equal(leaf.NodeId, Assert.Single(state.Document.Nodes.Single(n => n.Id == a.NodeId).ChildIds));
        Assert.Empty(state.Document.Nodes.Single(n => n.Id == b.NodeId).ChildIds);
        await handler.HandleAsync(new DeleteNodeCommand(documentId, Guid.NewGuid(), leaf.NodeId), actor);
        Assert.Equal("NODE_NOT_FOUND", (await handler.HandleAsync(moveAfterSnapshot with { CommandId = Guid.NewGuid() }, actor)).Code);
        Assert.Equal(34, (await Journal().ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task CompetingMovesRejectStaleParentAndDescendantCycles()
    {
        var screen = Guid.NewGuid();
        var root = Guid.NewGuid();
        var child = Guid.NewGuid();
        var other = Guid.NewGuid();
        await Journal().InitializeAsync(new(documentId, [], [new(screen, [root, other])],
            [new(root, "container", [child]), new(child, "container", []), new(other, "container", [])]));
        var cycle = new MoveNodeCommand(documentId, Guid.NewGuid(), root, screen, child, 0);
        Assert.Equal("CYCLE_NOT_ALLOWED", (await Handler(Journal()).HandleAsync(cycle, actor)).Code);
        var first = new MoveNodeCommand(documentId, Guid.NewGuid(), child, root, other, 0);
        var second = first with { CommandId = Guid.NewGuid(), TargetParentId = screen, Position = 0 };
        var results = await Task.WhenAll(Handler(Journal()).HandleAsync(first, actor), Handler(Journal()).HandleAsync(second, actor));
        Assert.Single(results, r => r.Accepted);
        Assert.Single(results, r => r.Code == "INVALID_LAYOUT_CONTEXT");
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(1, state.Revision);
        Assert.Empty(DocumentStructureValidator.Validate(state.Document, new Profile()));
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
