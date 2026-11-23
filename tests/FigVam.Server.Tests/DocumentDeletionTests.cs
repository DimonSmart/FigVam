using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentDeletionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-delete-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => false;
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    }
    private SqliteDocumentJournal Store() => new(directory, new Profile());
    private DocumentCommandHandler Handler(SqliteDocumentJournal store) => new(store, store, new Profile());
    private async Task<Guid> Create()
    {
        var id = Guid.NewGuid();
        Assert.True((await Store().CreateAsync(new(id), owner)).Accepted);
        await Store().SetMemberAsync(id, "editor", DocumentRole.Editor, owner);
        await Store().SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
        return id;
    }
    private long Scalar(Guid id, string sql)
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False");
        connection.Open(); using var command = connection.CreateCommand(); command.CommandText = sql;
        return (long)command.ExecuteScalar()!;
    }

    [Fact]
    public async Task OwnerDeletionRetainsDataAndOriginalResultAcrossRestartButClosesEveryAccessPath()
    {
        var id = await Create(); var other = await Create(); var store = Store();
        var saved = await Handler(store).HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Keep"), owner);
        var deletion = new DeleteDocumentCommand(id, Guid.NewGuid(), 1);
        foreach (var actor in new[] { "editor", "viewer", "outsider" })
            Assert.Equal("FORBIDDEN", (await Handler(store).HandleAsync(deletion, new(actor))).Code);
        Assert.Equal(1, (await store.ReadAsync(id))!.Revision);
        var result = await Handler(store).HandleAsync(deletion, owner);
        Assert.True(result.Accepted); Assert.Equal(2, result.Revision); Assert.Equal(new[] { id }, result.AffectedIds);
        store = Store(); // Simulates ACK loss and a new process reopening the durable database.
        Assert.Equal(result, await Handler(store).HandleAsync(deletion, owner));
        foreach (var actor in new[] { "editor", "viewer", "outsider" })
            Assert.Equal("FORBIDDEN", (await Handler(store).HandleAsync(deletion, new(actor))).Code);
        Assert.Null(await store.ReadAsync(id));
        Assert.Equal("DOCUMENT_NOT_FOUND", (await store.ReadAsync(id, 0)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await store.ReadVersionAsync(id, saved.VersionId!.Value)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await store.ListVersionsAsync(id, 10, null)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await store.ReadEventsAsync(id, 0)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await store.ReadHistoryAsync(id, owner.Id)).Code);
        Assert.DoesNotContain((await store.ListAsync(owner)).Items, d => d.DocumentId == id);
        foreach (var actor in new[] { owner, new DocumentActor("editor"), new DocumentActor("viewer") })
        {
            Assert.False(await store.CanReadAsync(actor, id, default));
            Assert.False(await store.CanEditAsync(actor, id, default));
            Assert.Equal("FORBIDDEN", (await Handler(store).HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Revive"), actor)).Code);
        }
        Assert.Equal("FORBIDDEN", (await Handler(store).HandleAsync(new RestoreDocumentVersionCommand(id, Guid.NewGuid(), saved.VersionId.Value), owner)).Code);
        Assert.Equal("FORBIDDEN", (await store.SetMemberAsync(id, "outsider", DocumentRole.Owner, owner)).Code);
        Assert.Equal("DOCUMENT_NOT_FOUND", (await Handler(store).HandleAsync(deletion with { CommandId = Guid.NewGuid() }, owner)).Code);
        Assert.Equal("DOCUMENT_EXISTS", (await store.CreateAsync(new(id), owner)).Code);
        Assert.Equal(2, Scalar(id, "SELECT MAX(revision) FROM events"));
        Assert.Equal(1, Scalar(id, "SELECT COUNT(*) FROM user_versions"));
        Assert.Equal(1, Scalar(id, "SELECT COUNT(*) FROM snapshots"));
        Assert.Equal(2, Scalar(id, "SELECT COUNT(*) FROM command_history"));
        Assert.NotNull(await store.ReadAsync(other));
    }

    [Fact]
    public async Task DeletionRetainsAssetBytesButDeniesHistoricalAssetAccess()
    {
        var id = await Create(); var store = Store(); var assetId = Guid.NewGuid();
        var uploaded = await Handler(store).HandleAsync(new UploadDocumentAssetCommand(id, Guid.NewGuid(), assetId, "image/png", DocumentAssetTests.Png()), owner);
        Assert.True(uploaded.Accepted);
        var asset = Assert.Single((await store.ReadAsync(id))!.Document.Assets);
        Assert.True((await Handler(store).HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 1), owner)).Accepted);
        Assert.Null(await Store().ReadAssetContentAsync(id, asset));
        Assert.Equal(1, Scalar(id, "SELECT COUNT(*) FROM asset_content"));
        var assets = new DocumentAssets(store, store, store, store);
        Assert.Equal("FORBIDDEN", (await assets.ReadAsync(id, assetId, owner, revision: 1)).Code);
    }

    [Fact]
    public async Task RevisionRefusalIsIdempotentAndCompetingDeletionHasExactlyOneCommit()
    {
        var id = await Create(); var store = Store(); var stale = new DeleteDocumentCommand(id, Guid.NewGuid(), 1);
        var refused = await Handler(store).HandleAsync(stale, owner);
        Assert.Equal("REVISION_CONFLICT", refused.Code); Assert.Equal(0, (await store.ReadAsync(id))!.Revision);
        Assert.Equal(refused, await Handler(Store()).HandleAsync(stale with { ExpectedRevision = 0 }, owner));
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Handler(Store()).HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 0), owner)));
        Assert.Single(results, r => r.Accepted); Assert.Equal(1, Scalar(id, "SELECT COUNT(*) FROM events"));
        Assert.Equal(1, Scalar(id, "SELECT revision FROM document_deletion"));
    }

    [Fact]
    public async Task ConcurrentEditCannotCrossTheDeletionRevisionBoundary()
    {
        var id = await Create();
        var results = await Task.WhenAll(
            Handler(Store()).HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 0), owner),
            Handler(Store()).HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Concurrent"), new("editor")));
        if (results[0].Accepted)
        {
            Assert.False(results[1].Accepted); Assert.Null(await Store().ReadAsync(id));
            Assert.Equal(1, Scalar(id, "SELECT MAX(revision) FROM events"));
        }
        else
        {
            Assert.Equal("REVISION_CONFLICT", results[0].Code); Assert.True(results[1].Accepted);
            Assert.Equal(1, (await Store().ReadAsync(id))!.Revision);
        }
    }

    [Theory]
    [InlineData("document_deletion")]
    [InlineData("results")]
    public async Task DeletionFailureRollsBackEventResultTombstoneAndRevision(string table)
    {
        var id = await Create(); var store = Store(); var deletion = new DeleteDocumentCommand(id, Guid.NewGuid(), 0);
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False"))
        {
            connection.Open(); using var command = connection.CreateCommand();
            command.CommandText = $"CREATE TRIGGER fail_delete BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'test failure'); END"; command.ExecuteNonQuery();
        }
        await Assert.ThrowsAsync<SqliteException>(() => Handler(store).HandleAsync(deletion, owner));
        Assert.Equal(0, (await Store().ReadAsync(id))!.Revision);
        Assert.Equal(0, Scalar(id, "SELECT COUNT(*) FROM events")); Assert.Equal(0, Scalar(id, "SELECT COUNT(*) FROM results"));
        Assert.True(await Store().CanReadAsync(owner, id, default));
    }

    [Fact]
    public async Task DeletionStopsExistingSubscriptionIncludingBufferedEvents()
    {
        var id = await Create(); var store = Store();
        await Handler(store).HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Buffered"), owner);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var reader = new DocumentReconnectReader(store, store);
        await using var stream = new DocumentSubscriptions(reader, store).ReadAsync(id, 0, new("viewer"), deadline.Token).GetAsyncEnumerator();
        Assert.True(await stream.MoveNextAsync()); Assert.Equal("READY", stream.Current.Code);
        Assert.True((await Handler(store).HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 1), owner)).Accepted);
        Assert.True(await stream.MoveNextAsync()); Assert.Equal("FORBIDDEN", stream.Current.Code); Assert.Null(stream.Current.Change);
        Assert.False(await stream.MoveNextAsync());
    }
    [Fact]
    public async Task VersionListAdmittedBeforeDeletionReturnsNotFoundInsteadOfServerError()
    {
        var id = await Create(); var store = Store();
        var authorization = new DeleteAfterReadAdmission(store, Handler(store), owner);
        var controller = new FigVam.Server.Documents.DocumentVersionController(new DocumentVersionReader(authorization, store));
        controller.ControllerContext = new Microsoft.AspNetCore.Mvc.ControllerContext
        {
            HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
            {
                User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                    [new System.Security.Claims.Claim("sub", owner.Id)], "test"))
            }
        };
        var response = Assert.IsType<Microsoft.AspNetCore.Mvc.ObjectResult>(await controller.List(id));
        Assert.Equal(404, response.StatusCode);
        Assert.Equal("DOCUMENT_NOT_FOUND", Assert.IsType<FigVam.Server.Documents.ApiError>(response.Value).Code);
        Assert.Null(await Store().ReadAsync(id));
    }
    private sealed class DeleteAfterReadAdmission(SqliteDocumentJournal store, DocumentCommandHandler handler, DocumentActor owner) : IDocumentAuthorization
    {
        public async ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct)
        {
            var allowed = await store.CanReadAsync(actor, id, ct);
            Assert.True((await handler.HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 0), owner, ct)).Accepted);
            return allowed;
        }
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => store.CanEditAsync(actor, id, ct);
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken ct) => store.CanDeleteAsync(actor, id, ct);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
