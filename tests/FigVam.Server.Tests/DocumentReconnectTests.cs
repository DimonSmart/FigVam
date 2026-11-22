using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentReconnectTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-reconnect-" + Guid.NewGuid());
    private readonly Guid documentId = Guid.NewGuid();
    private readonly DocumentActor actor = new("authenticated-user");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Version1;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind is "container" or "leaf";
        public bool CanContainChildren(string kind) => kind == "container";
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public Guid AllowedDocument { get; set; }
        public bool ReadAllowed { get; set; } = true;
        public int ReadChecks { get; private set; }
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
        {
            ReadChecks++;
            return ValueTask.FromResult(ReadAllowed && documentId == AllowedDocument);
        }
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(false);
    }
    private sealed class Editor : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(true);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Editor(), Journal(), new Profile());
    private DocumentReconnectReader Reader() => new(new Authorization { AllowedDocument = documentId }, Journal());
    private Task Seed() => Journal().InitializeAsync(new(documentId, [], [], []));

    [Fact]
    public async Task EveryCommittedCommandHasOrderedIdentityAndMinimalReplayPayload()
    {
        await Seed();
        var handler = Handler();
        var page = new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid());
        var screen = new AddScreenCommand(documentId, Guid.NewGuid(), page.PageId, Guid.NewGuid(), new(800, 600));
        var root = new AddNodeCommand(documentId, Guid.NewGuid(), screen.ScreenId, Guid.NewGuid(), "container");
        var leaf = new AddNodeCommand(documentId, Guid.NewGuid(), root.NodeId, Guid.NewGuid(), "leaf");
        var move = new MoveNodeCommand(documentId, Guid.NewGuid(), leaf.NodeId, root.NodeId, screen.ScreenId, 0);
        var reorder = new MoveNodeCommand(documentId, Guid.NewGuid(), root.NodeId, screen.ScreenId, screen.ScreenId, 0);
        var delete = new DeleteNodeCommand(documentId, Guid.NewGuid(), root.NodeId);
        var results = new[]
        {
            await handler.HandleAsync(page, actor), await handler.HandleAsync(screen, actor),
            await handler.HandleAsync(root, actor), await handler.HandleAsync(leaf, actor),
            await handler.HandleAsync(move, actor), await handler.HandleAsync(reorder, actor),
            await handler.HandleAsync(delete, actor)
        };
        // A repeated command and a rejection must never become extra committed events.
        Assert.Equal(results[0], await handler.HandleAsync(page, actor));
        Assert.Equal("NODE_NOT_FOUND", (await handler.HandleAsync(delete with { CommandId = Guid.NewGuid() }, actor)).Code);
        var reconnect = await Reader().ReadAsync(documentId, 0, actor);
        Assert.Equal("EVENTS", reconnect.Code);
        Assert.Equal(7, reconnect.Revision);
        Assert.Null(reconnect.Snapshot);
        var events = reconnect.Events!;
        Assert.Equal(results.Select(r => r.CommandId), events.Select(e => e.CommandId));
        Assert.Equal(Enumerable.Range(1, 7).Select(i => (long)i), events.Select(e => e.Revision));
        Assert.All(events, e => { Assert.Equal(documentId, e.DocumentId); Assert.Equal(actor.Id, e.ActorId); });
        Assert.Equal(new[] { "ADD_PAGE", "ADD_SCREEN", "ADD_NODE", "ADD_NODE", "MOVE_NODE", "MOVE_NODE", "DELETE_NODE" }, events.Select(e => e.Type));
        Assert.Equal(new DocumentEvent[]
        {
            new PageAdded(page.PageId), new ScreenAdded(page.PageId, screen.ScreenId, new(800, 600)),
            new NodeAdded(screen.ScreenId, root.NodeId, "container"), new NodeAdded(root.NodeId, leaf.NodeId, "leaf"),
            new NodeMoved(leaf.NodeId, screen.ScreenId, 0), new NodeMoved(root.NodeId, screen.ScreenId, 0),
            new NodeDeleted(root.NodeId)
        }, events.Select(e => e.Payload));
        var client = new DocumentStructure(documentId, [], [], []);
        foreach (var item in events)
        {
            client = Apply(client, item.Payload);
            var recovered = await Journal().ReadAsync(documentId, item.Revision);
            Assert.Equal("OK", recovered.Code);
            Assert.Equal(System.Text.Json.JsonSerializer.Serialize(client),
                System.Text.Json.JsonSerializer.Serialize(recovered.State!.Document));
        }
        var current = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(current.Document), System.Text.Json.JsonSerializer.Serialize(client));
        var missed = await Reader().ReadAsync(documentId, 3, actor);
        Assert.Equal(events.Skip(3), missed.Events!);
        var caughtUp = await Reader().ReadAsync(documentId, 7, actor);
        Assert.Equal("EVENTS", caughtUp.Code);
        Assert.Empty(caughtUp.Events!);
    }

    [Fact]
    public async Task EveryReconnectChecksReadRightsAndRevocationWithoutLeakingOtherDocuments()
    {
        await Seed();
        var other = Guid.NewGuid();
        await Journal().InitializeAsync(new(other, [], [], []));
        await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor);
        var rights = new Authorization { AllowedDocument = documentId };
        var reader = new DocumentReconnectReader(rights, Journal());
        Assert.Equal("EVENTS", (await reader.ReadAsync(documentId, 0, actor)).Code);
        Assert.Equal("FORBIDDEN", (await reader.ReadAsync(other, 0, actor)).Code);
        rights.ReadAllowed = false;
        var denied = await reader.ReadAsync(documentId, 0, actor);
        Assert.Equal(new DocumentReconnectResult("FORBIDDEN"), denied);
        Assert.Equal(3, rights.ReadChecks);
        Assert.Equal("FORBIDDEN", (await reader.ReadAsync(documentId, 0, new(""))).Code);
        Assert.Equal(3, rights.ReadChecks);
    }

    [Fact]
    public async Task InvalidRevisionsAndUnknownDocumentsAreRejected()
    {
        await Seed();
        Assert.Equal("INVALID_REVISION", (await Reader().ReadAsync(documentId, -1, actor)).Code);
        Assert.Equal("INVALID_REVISION", (await Reader().ReadAsync(documentId, 1, actor)).Code);
        Assert.Equal("INVALID_REVISION", (await Reader().ReadAsync(documentId, long.MaxValue, actor)).Code);
        var reader = new DocumentReconnectReader(new Editor(), Journal());
        Assert.Equal("INVALID_ID", (await reader.ReadAsync(Guid.Empty, 0, actor)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await reader.ReadAsync(Guid.NewGuid(), 0, actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task MissingHistoryReturnsCurrentSnapshotWhileAvailableSuffixRemainsReadable()
    {
        await Seed();
        for (var i = 0; i < 35; i++)
            await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor);
        // Simulate unavailable history covered by the existing revision-32 recovery snapshot.
        // Production retention policy is deliberately outside this test and implementation.
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{documentId:N}.sqlite")};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM events WHERE revision<=32";
            command.ExecuteNonQuery();
        }
        foreach (var lastSeen in new long[] { 0, 20, 31 })
        {
            var result = await Reader().ReadAsync(documentId, lastSeen, actor);
            Assert.Equal("SNAPSHOT", result.Code);
            Assert.Null(result.Events);
            Assert.Equal(35, result.Revision);
            Assert.Equal(35, result.Snapshot!.Revision);
            Assert.Equal(documentId, result.Snapshot.Document.Id);
            Assert.Equal(35, result.Snapshot.Document.Pages.Count);
        }
        var suffix = await Reader().ReadAsync(documentId, 32, actor);
        Assert.Equal("EVENTS", suffix.Code);
        Assert.Equal(new long[] { 33, 34, 35 }, suffix.Events!.Select(e => e.Revision));
    }

    [Fact]
    public async Task FiveReadersConvergeWhileIndependentInstancesCommitConcurrently()
    {
        await Seed();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var writers = Enumerable.Range(0, 2).Select(async _ =>
        {
            await start.Task;
            var handler = Handler();
            for (var i = 0; i < 20; i++)
                Assert.True((await handler.HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor)).Accepted);
        }).ToArray();
        var readers = Enumerable.Range(0, 5).Select(async _ =>
        {
            await start.Task;
            var reader = Reader();
            long revision = 0;
            var pages = new List<Guid>();
            do
            {
                var response = await reader.ReadAsync(documentId, revision, actor);
                Assert.Equal("EVENTS", response.Code);
                foreach (var item in response.Events!)
                {
                    Assert.Equal(++revision, item.Revision);
                    pages.Add(Assert.IsType<PageAdded>(item.Payload).PageId);
                }
                Assert.Equal(revision, response.Revision);
                if (revision < 40) await Task.Delay(1);
            } while (revision < 40);
            return pages;
        }).ToArray();
        start.SetResult();
        await Task.WhenAll(writers.Concat<Task>(readers)).WaitAsync(TimeSpan.FromSeconds(30));
        var expected = (await Journal().ReadAsync(documentId))!.Document.Pages.Select(p => p.Id).ToArray();
        foreach (var reader in readers) Assert.Equal(expected, await reader);
    }

    private static DocumentStructure Apply(DocumentStructure document, DocumentEvent payload) => payload switch
    {
        PageAdded p => document with { Pages = document.Pages.Append(new(p.PageId, [])).ToArray() },
        ScreenAdded s => document with
        {
            Pages = document.Pages.Select(p => p.Id == s.PageId ? p with { ScreenIds = p.ScreenIds.Append(s.ScreenId).ToArray() } : p).ToArray(),
            Screens = document.Screens.Append(new(s.ScreenId, [], s.Dimensions)).ToArray()
        },
        NodeAdded n => document with
        {
            Screens = document.Screens.Select(s => s.Id == n.ParentId ? s with { ChildIds = s.ChildIds.Append(n.NodeId).ToArray() } : s).ToArray(),
            Nodes = document.Nodes.Select(p => p.Id == n.ParentId ? p with { ChildIds = p.ChildIds.Append(n.NodeId).ToArray() } : p)
                .Append(new(n.NodeId, n.Kind, [])).ToArray()
        },
        NodeMoved m => DocumentStructureEditor.MoveNode(document, m.NodeId, m.TargetParentId, m.Position),
        NodeDeleted d => DocumentStructureEditor.DeleteNode(document, d.NodeId),
        _ => throw new InvalidOperationException()
    };

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
