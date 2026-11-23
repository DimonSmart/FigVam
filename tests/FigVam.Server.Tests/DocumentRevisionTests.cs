using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentRevisionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-revisions-" + Guid.NewGuid());
    private readonly Guid id = Guid.NewGuid();
    private readonly DocumentActor actor = new("reader");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind == "Frame";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "text" ? new(NodePropertyType.String) : null;
    }
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "reader");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Access(), Journal(), new Profile());
    private void Sql(string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = Path.Combine(directory, $"{id:N}.sqlite"), Pooling = false }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    [Fact]
    public async Task HistoricalStatesReplayAllChangesAcrossSnapshotBoundary()
    {
        var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid(); var child = Guid.NewGuid();
        await Journal().InitializeAsync(new(id, [], [], []));
        var expected = new List<string> { JsonSerializer.Serialize(await Journal().ReadAsync(id)) };
        async Task Record(CommandResult result)
        {
            Assert.True(result.Accepted, result.Code);
            expected.Add(JsonSerializer.Serialize(await Journal().ReadAsync(id)));
        }
        var handler = Handler();
        await Record(await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), page), actor));
        await Record(await handler.HandleAsync(new AddScreenCommand(id, Guid.NewGuid(), page, screen, new(800, 600)), actor));
        await Record(await handler.HandleAsync(new AddNodeCommand(id, Guid.NewGuid(), screen, node, "Frame"), actor));
        await Record(await handler.HandleAsync(new AddNodeCommand(id, Guid.NewGuid(), node, child, "Frame"), actor));
        await Record(await handler.HandleAsync(new SetNodeNameCommand(id, Guid.NewGuid(), node, "Before"), actor));
        await Record(await handler.HandleAsync(new SetNodeSemanticKeyCommand(id, Guid.NewGuid(), node, "main"), actor));
        await Record(await handler.HandleAsync(new SetNodePropertyCommand(id, Guid.NewGuid(), node, "text", new NodeStringValue("old")), actor));
        var saved = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), actor);
        await Record(saved);
        await Record(await handler.HandleAsync(new MoveNodeCommand(id, Guid.NewGuid(), child, node, screen, 0), actor));
        await Record(await handler.HandleAsync(new DeleteNodeCommand(id, Guid.NewGuid(), node), actor));
        await Record(await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), actor));
        await Record(await handler.HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), actor));
        await Record(await handler.HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), saved.VersionId!.Value), actor));
        for (var i = 0; i < 25; i++)
            await Record(await handler.HandleAsync(new SetNodeNameCommand(id, Guid.NewGuid(), node, "Name " + i), actor));
        for (var revision = 0; revision < expected.Count; revision++)
        {
            var read = await Journal().ReadAsync(id, revision);
            Assert.Equal("OK", read.Code);
            Assert.Equal(expected[revision], JsonSerializer.Serialize(read.State));
        }
        Assert.Equal(expected[^1], JsonSerializer.Serialize((await Journal().ReadAsync(id, revision: null)).State));
        var queries = new DocumentStructureQueries(new Access(), Journal(), new Profile());
        var oldNode = Assert.Single((await queries.QueryAsync(id, new("nodes", SemanticKey: "main", NamePrefix: "Bef", Revision: 7), actor)).Response!.Items);
        Assert.Equal("Before", oldNode.Name);
        Assert.Equal(new NodeStringValue("old"), oldNode.Properties!["text"]);
        Assert.Empty((await queries.QueryAsync(id, new("nodes", NamePrefix: "Bef"), actor)).Response!.Items);
        Assert.Equal(child, Assert.Single((await queries.QueryAsync(id, new("children", node, Revision: 7), actor)).Response!.Items).Id);
        Assert.Empty((await queries.QueryAsync(id, new("children", node, Revision: 9), actor)).Response!.Items);
        Assert.Equal("NODE_NOT_FOUND", (await queries.QueryAsync(id, new("node", node, Revision: 10), actor)).Code);
        Assert.Equal("Before", Assert.Single((await queries.QueryAsync(id, new("node", node, Revision: 11), actor)).Response!.Items).Name);
    }

    [Fact]
    public async Task MissingSnapshotOrJournalRangeNeverSubstitutesCurrentState()
    {
        await Journal().InitializeAsync(new(id, [], [], []));
        for (var i = 0; i < 34; i++)
            Assert.True((await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), actor)).Accepted);
        Assert.Equal("INVALID_REVISION", (await Journal().ReadAsync(id, -1)).Code);
        Assert.Equal("INVALID_REVISION", (await Journal().ReadAsync(id, long.MaxValue)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await Journal().ReadAsync(Guid.NewGuid(), 0)).Code);
        Sql("DELETE FROM events WHERE revision=5");
        Assert.Equal("REVISION_UNAVAILABLE", (await Journal().ReadAsync(id, 7)).Code);
        // Even a gap immediately before the target must not produce a partial historical response.
        Assert.Equal("REVISION_UNAVAILABLE", (await Journal().ReadAsync(id, 5)).Code);
        Assert.Equal(32, (await Journal().ReadAsync(id, 32)).State!.Revision);
        Sql("DELETE FROM snapshots WHERE revision=0");
        Assert.Equal("REVISION_UNAVAILABLE", (await Journal().ReadAsync(id, 0)).Code);
        Assert.Equal(34, (await Journal().ReadAsync(id))!.Revision);
        var queries = new DocumentStructureQueries(new Access(), Journal(), new Profile());
        Assert.Equal("REVISION_UNAVAILABLE", (await queries.QueryAsync(id, new("pages", Revision: 1), actor)).Code);
        foreach (var revision in new long[] { -1, 0, 1, long.MaxValue })
            Assert.Equal("FORBIDDEN", (await queries.QueryAsync(id, new("pages", Revision: revision), new("outsider"))).Code);
        Sql("DELETE FROM events WHERE revision=33");
        Assert.Equal("REVISION_UNAVAILABLE", (await Journal().ReadAsync(id, 34)).Code);
    }

    [Fact]
    public async Task ConcurrentCommitsAndReadsKeepRequestedRevisionConsistent()
    {
        await Journal().InitializeAsync(new(id, [], [], []));
        var writer = Task.Run(async () =>
        {
            for (var i = 0; i < 40; i++)
                Assert.True((await Handler().HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), actor)).Accepted);
        });
        do
        {
            var current = (await Journal().ReadAsync(id, revision: null)).State!;
            var target = current.Revision / 2;
            var historical = (await Journal().ReadAsync(id, target)).State!;
            Assert.Equal(target, historical.Revision);
            Assert.Equal(target, historical.Document.Pages.Count);
            Assert.Equal(current.Document.Pages.Take((int)target).Select(p => p.Id), historical.Document.Pages.Select(p => p.Id));
        } while (!writer.IsCompleted);
        await writer;
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
