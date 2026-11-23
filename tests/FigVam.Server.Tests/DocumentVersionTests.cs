using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentVersionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-versions-" + Guid.NewGuid());
    private readonly Guid documentId = Guid.NewGuid();
    private readonly DocumentActor actor = new("authenticated-editor");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind == "container";
        public bool CanContainChildren(string kind) => kind == "container";
    }
    private sealed class Authorization(bool read = true, bool edit = true) : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(read);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(edit);
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler(bool edit = true)
        => new(new Authorization(edit: edit), Journal(), new Profile());
    private DocumentVersionReader Reader(bool read = true)
        => new(new Authorization(read: read), Journal());
    private Task Seed() => Journal().InitializeAsync(new(documentId, [], [], []));
    private SaveDocumentCommand Save(string? name = null) => new(documentId, Guid.NewGuid(), name);
    private void Sql(string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = Path.Combine(directory, $"{documentId:N}.sqlite"), Pooling = false }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    [Fact]
    public async Task AuthorizationIsCheckedForSaveRetryAndEveryVersionRead()
    {
        await Seed();
        var command = Save();
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(documentId))!.Revision);
        var saved = await Handler().HandleAsync(command, actor);
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, actor)).Code);
        Assert.Equal("FORBIDDEN", (await Reader(false).ReadAsync(documentId, saved.VersionId!.Value, actor)).Code);
        Assert.Equal("VERSION_NOT_FOUND", (await Reader().ReadAsync(Guid.NewGuid(), saved.VersionId.Value, actor)).Code);
        Assert.Equal("VERSION", (await Reader().ReadAsync(documentId, saved.VersionId.Value, actor)).Code);
    }

    [Fact]
    public async Task NamedAndUnnamedVersionsSurviveReopenEditsAndIdempotentRetry()
    {
        await Seed();
        var command = Save("Review");
        var saved = await Handler().HandleAsync(command, actor);
        await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor);
        var retries = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Handler().HandleAsync(command with { Name = "Other" }, actor)));
        Assert.All(retries, result => Assert.Equal(saved, result));
        var version = (await Reader().ReadAsync(documentId, saved.VersionId!.Value, actor)).Version!;
        Assert.Equal("Review", version.Name);
        Assert.Equal(saved.Timestamp, version.Timestamp);
        Assert.Equal(actor.Id, version.AuthorId);
        Assert.Equal(saved.Revision, version.Snapshot.Revision);
        Assert.Empty(version.Snapshot.Document.Pages);
        var unnamed = await Handler().HandleAsync(Save(), actor);
        var later = (await Reader().ReadAsync(documentId, unnamed.VersionId!.Value, actor)).Version!;
        Assert.Null(later.Name);
        Assert.Single(later.Snapshot.Document.Pages);
        // Readers own detached deserialized collections; mutation cannot rewrite storage.
        ((IList<PageStructure>)later.Snapshot.Document.Pages)[0] = new(Guid.NewGuid(), []);
        Assert.NotEqual(later.Snapshot.Document.Pages[0].Id,
            (await Reader().ReadAsync(documentId, unnamed.VersionId.Value, actor)).Version!.Snapshot.Document.Pages[0].Id);
        Assert.Equal(3, (await Journal().ReadAsync(documentId))!.Revision);
        var events = await Journal().ReadEventsAsync(documentId, 0);
        Assert.IsType<VersionSaved>(events.Events![0].Payload);
        Assert.Equal(3, events.Events.Count);
    }

    [Fact]
    public async Task ConcurrentFirstAttemptsOfSameSaveCreateOneVersion()
    {
        await Seed();
        var command = Save("Shared retry");
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Handler().HandleAsync(command, actor)));
        Assert.All(results, result => Assert.Equal(results[0], result));
        Assert.Equal(1, (await Journal().ReadAsync(documentId))!.Revision);
        Sql("CREATE TEMP TABLE assertion(value INTEGER CHECK(value=1)); INSERT INTO assertion SELECT COUNT(*) FROM user_versions;");
        Assert.Equal("Shared retry", (await Reader().ReadAsync(documentId, results[0].VersionId!.Value, actor)).Version!.Name);
    }

    [Fact]
    public async Task ConcurrentSavesAndEditsCaptureTheirExactSerializedStreamRevision()
    {
        await Seed();
        var results = await Task.WhenAll(Enumerable.Range(0, 40).Select(i => i % 2 == 0
            ? Handler().HandleAsync(Save(), actor)
            : Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor)));
        Assert.All(results, result => Assert.True(result.Accepted));
        Assert.Equal(Enumerable.Range(1, 40).Select(i => (long?)i), results.Select(r => r.Revision).Order());
        var pages = new List<Guid>();
        foreach (var result in results.OrderBy(r => r.Revision))
        {
            if (result.PageId is { } page) pages.Add(page);
            else
            {
                var version = (await Reader().ReadAsync(documentId, result.VersionId!.Value, actor)).Version!;
                Assert.Equal(result.Revision, version.Snapshot.Revision);
                Assert.Equal(pages, version.Snapshot.Document.Pages.Select(p => p.Id));
            }
        }
        var state = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(40, state.Revision);
        Assert.Equal(pages, state.Document.Pages.Select(p => p.Id));
    }

    [Fact]
    public async Task HistoryIsAuthorizedIsolatedAndPagedAcrossReopen()
    {
        await Seed();
        var first = await Handler().HandleAsync(Save("First"), actor);
        var second = await Handler().HandleAsync(Save(), actor);
        var third = await Handler().HandleAsync(Save("Third"), actor);

        Assert.Equal("FORBIDDEN", (await Reader(false).ListAsync(documentId, actor)).Code);
        Assert.Equal("INVALID_PAGE", (await Reader().ListAsync(documentId, actor, 101)).Code);
        Assert.Empty((await Reader().ListAsync(Guid.NewGuid(), actor)).Versions!);
        var page = await Reader().ListAsync(documentId, actor, 2);
        Assert.Equal("VERSIONS", page.Code);
        var versions = Assert.IsAssignableFrom<IReadOnlyList<DocumentVersionMetadata>>(page.Versions);
        Assert.Equal(new[] { third.VersionId, second.VersionId }, versions.Select(v => (Guid?)v.Id));
        Assert.Equal("Third", versions[0].Name);
        Assert.Null(versions[1].Name);
        Assert.Equal(actor.Id, versions[0].AuthorId);
        Assert.Equal(third.Timestamp, versions[0].Timestamp);
        Assert.Equal(third.Revision, versions[0].Revision);
        var next = await Reader().ListAsync(documentId, actor, 2, page.NextBeforeRevision);
        Assert.Equal(first.VersionId, Assert.Single(next.Versions!).Id);
        Assert.Null(next.NextBeforeRevision);
        Assert.Equal("FORBIDDEN", (await Reader(false).ListAsync(documentId, actor, 2, page.NextBeforeRevision)).Code);
    }

    [Fact]
    public async Task StoredVersionCorruptionIsDetectedWithoutAffectingDraftOrOtherVersions()
    {
        await Seed();
        var first = await Handler().HandleAsync(Save(), actor);
        var second = await Handler().HandleAsync(Save("Intact"), actor);
        Sql($"UPDATE user_versions SET payload=replace(payload,'authenticated-editor','tampered-editor') WHERE version_id='{first.VersionId}'");
        await Assert.ThrowsAsync<InvalidDataException>(() => Reader().ReadAsync(documentId, first.VersionId!.Value, actor));
        await Assert.ThrowsAsync<InvalidDataException>(() => Reader().ListAsync(documentId, actor));
        Assert.Equal("Intact", (await Reader().ReadAsync(documentId, second.VersionId!.Value, actor)).Version!.Name);
        Assert.Equal(2, (await Journal().ReadAsync(documentId))!.Revision);
    }

    [Fact]
    public async Task FailureAfterSnapshotInsertRollsBackVersionEventResultAndRevision()
    {
        await Seed();
        var command = Save("Retry after failure");
        Sql("CREATE TRIGGER fail_result BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
        await Assert.ThrowsAsync<SqliteException>(() => Handler().HandleAsync(command, actor));
        Assert.Equal(0, (await Journal().ReadAsync(documentId))!.Revision);
        Sql("CREATE TEMP TABLE assertion(value INTEGER CHECK(value=0)); INSERT INTO assertion SELECT COUNT(*) FROM user_versions; INSERT INTO assertion SELECT COUNT(*) FROM events; INSERT INTO assertion SELECT COUNT(*) FROM results;");
        Sql("DROP TRIGGER fail_result;");
        var result = await Handler().HandleAsync(command, actor);
        Assert.True(result.Accepted);
        Assert.Equal(1, result.Revision);
        Assert.Equal("VERSION", (await Reader().ReadAsync(documentId, result.VersionId!.Value, actor)).Code);
    }

    [Fact]
    public async Task RestoreIsExplicitImmutableIdempotentAndReplaysForReconnectAfterRestart()
    {
        await Seed();
        var pageId = Guid.NewGuid();
        await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), pageId), actor);
        var saved = await Handler().HandleAsync(Save("Restore target"), actor);
        var before = (await Reader().ReadAsync(documentId, saved.VersionId!.Value, actor)).Version!;
        await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor);
        var later = await Handler().HandleAsync(Save("Later"), actor);
        var laterBefore = (await Reader().ReadAsync(documentId, later.VersionId!.Value, actor)).Version!;
        // Browsing the old version leaves the current draft intact.
        Assert.Equal(2, (await Journal().ReadAsync(documentId))!.Document.Pages.Count);
        var command = new RestoreDocumentVersionCommand(documentId, Guid.NewGuid(), before.Id);
        var result = await Handler().HandleAsync(command, actor);
        Assert.True(result.Accepted);
        Assert.Equal(5, result.Revision);
        Assert.Equal(before.Id, result.VersionId);
        var recovered = (await Journal().ReadAsync(documentId))!;
        Assert.Equal(5, recovered.Revision);
        Assert.Equal(pageId, Assert.Single(recovered.Document.Pages).Id);
        var retries = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Handler().HandleAsync(command with { VersionId = Guid.NewGuid() }, actor)));
        Assert.All(retries, retry => Assert.Equal(result, retry));
        Assert.Equal(5, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(before), System.Text.Json.JsonSerializer.Serialize(
            (await Reader().ReadAsync(documentId, before.Id, actor)).Version));
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(laterBefore), System.Text.Json.JsonSerializer.Serialize(
            (await Reader().ReadAsync(documentId, laterBefore.Id, actor)).Version));
        Assert.Equal(2, (await Reader().ListAsync(documentId, actor)).Versions!.Count);
        var reconnect = await new DocumentReconnectReader(new Authorization(), Journal()).ReadAsync(documentId, 4, actor);
        var committed = Assert.Single(reconnect.Events!);
        Assert.Equal(command.CommandId, committed.CommandId);
        Assert.Equal(actor.Id, committed.ActorId);
        Assert.Equal("RESTORE_VERSION", committed.Type);
        var restored = Assert.IsType<VersionRestored>(committed.Payload);
        Assert.Equal(before.Id, restored.VersionId);
        Assert.Equal(pageId, Assert.Single(restored.Document.Pages).Id);
        Assert.Equal(5, (await Journal().ReadEventsAsync(documentId, 0)).Events!.Count);
        // Subsequent journal replay continues from the restored tree.
        await Handler().HandleAsync(new AddScreenCommand(documentId, Guid.NewGuid(), pageId, Guid.NewGuid(), new(800, 600)), actor);
        Assert.Single((await Journal().ReadAsync(documentId))!.Document.Screens);
    }

    [Fact]
    public async Task RestoreRejectsUnauthorizedMissingCrossDocumentAndCorruptedVersionsWithoutRevision()
    {
        await Seed();
        var saved = await Handler().HandleAsync(Save(), actor);
        var command = new RestoreDocumentVersionCommand(documentId, Guid.NewGuid(), saved.VersionId!.Value);
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, actor)).Code);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(command, new(""))).Code);
        Assert.Equal("INVALID_ID", (await Handler().HandleAsync(command with { VersionId = Guid.Empty }, actor)).Code);
        var missing = command with { CommandId = Guid.NewGuid(), VersionId = Guid.NewGuid() };
        Assert.Equal("VERSION_NOT_FOUND", (await Handler().HandleAsync(missing, actor)).Code);
        var other = Guid.NewGuid();
        await Journal().InitializeAsync(new(other, [], [], []));
        Assert.Equal("VERSION_NOT_FOUND", (await Handler().HandleAsync(command with { DocumentId = other }, actor)).Code);
        Assert.Equal(0, (await Journal().ReadAsync(other))!.Revision);
        Sql($"UPDATE user_versions SET payload=replace(payload,'authenticated-editor','tampered-editor') WHERE version_id='{saved.VersionId}'");
        Assert.Equal("INVALID_VERSION", (await Handler().HandleAsync(command, actor)).Code);
        Assert.Equal(1, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Single((await Journal().ReadEventsAsync(documentId, 0)).Events!);
    }

    [Fact]
    public async Task RestoreValidatesSavedStructureEvenWithCorrectHash()
    {
        await Seed();
        var saved = await Handler().HandleAsync(Save(), actor);
        var original = (await Reader().ReadAsync(documentId, saved.VersionId!.Value, actor)).Version!;
        var invalid = original with { Snapshot = original.Snapshot with {
            Document = original.Snapshot.Document with { Pages = [new(documentId, [])] } } };
        var payload = System.Text.Json.JsonSerializer.Serialize(invalid);
        using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = Path.Combine(directory, $"{documentId:N}.sqlite"), Pooling = false }.ToString()))
        {
            connection.Open();
            using var update = connection.CreateCommand();
            update.CommandText = "UPDATE user_versions SET payload=$payload,sha256=$hash";
            update.Parameters.AddWithValue("$payload", payload);
            update.Parameters.AddWithValue("$hash", System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(payload)));
            update.ExecuteNonQuery();
        }
        var result = await Handler().HandleAsync(new RestoreDocumentVersionCommand(documentId,
            Guid.NewGuid(), original.Id), actor);
        Assert.Equal("INVALID_VERSION", result.Code);
        Assert.Equal(1, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Empty((await Journal().ReadAsync(documentId))!.Document.Pages);
    }

    [Fact]
    public async Task RestoreCommitFailureRollsBackAndRetryAfterReopenSucceeds()
    {
        await Seed();
        var saved = await Handler().HandleAsync(Save(), actor);
        await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), Guid.NewGuid()), actor);
        var command = new RestoreDocumentVersionCommand(documentId, Guid.NewGuid(), saved.VersionId!.Value);
        Sql("CREATE TRIGGER fail_restore_result BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
        await Assert.ThrowsAsync<SqliteException>(() => Handler().HandleAsync(command, actor));
        Assert.Equal(2, (await Journal().ReadAsync(documentId))!.Revision);
        Assert.Single((await Journal().ReadAsync(documentId))!.Document.Pages);
        Sql("CREATE TEMP TABLE assertion(value INTEGER CHECK(value=0)); INSERT INTO assertion SELECT COUNT(*) FROM restore_events;");
        Sql("DROP TRIGGER fail_restore_result;");
        var restored = await Handler().HandleAsync(command, actor);
        Assert.Equal(3, restored.Revision);
        Assert.Empty((await Journal().ReadAsync(documentId))!.Document.Pages);
        Assert.Equal("FORBIDDEN", (await Handler(false).HandleAsync(command, actor)).Code);
        Assert.Equal(restored, await Handler().HandleAsync(command, actor));
    }

    public void Dispose() => Directory.Delete(directory, true);
}

