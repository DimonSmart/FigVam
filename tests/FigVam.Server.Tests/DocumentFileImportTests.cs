using System.Text;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentFileImportTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-import-" + Guid.NewGuid());
    private readonly DocumentActor actor = new("importer");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "frame";
        public bool CanContainChildren(string kind) => kind == "frame";
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent value) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction value) => false;
        public bool SupportsDemoValue(string kind) => false;
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentFileImporter Importer(SqliteDocumentJournal journal) => new(new DocumentFileReader(new Profile()), journal);
    private static DocumentStructure Document()
    {
        var screen = Guid.NewGuid(); var root = Guid.NewGuid(); var child = Guid.NewGuid();
        return new(Guid.NewGuid(), [new(Guid.NewGuid(), [screen]) { Name = "Imported page" }],
            [new(screen, [root], new(800, 600))], [new(root, "frame", [child]), new(child, "frame", [])])
        { Name = "Imported document", Datasets = [new(Guid.NewGuid(), "Fixture", "{ \"text\": \"<script>data</script>\" }")] };
    }
    private sealed class Exporter(byte[] bytes) : IDocumentJsonExporter
    {
        public Task<DocumentJsonExportResult> ExportAsync(Guid id, long? revision, Guid? version, DocumentActor actor,
            CancellationToken cancellationToken = default) => Task.FromResult(new DocumentJsonExportResult("OK", bytes));
    }
    internal static async Task<byte[]> File(DocumentJsonExport source, DocumentFileFormat format)
    {
        var json = DocumentJsonFormat.Serialize(source);
        return format == DocumentFileFormat.Json ? json :
            (await new DocumentContainerExporter(new Exporter(json), new EmptyAssetStore()).ExportAsync(source.Document.Id, null, null, new("source"))).Content!;
    }

    [Theory]
    [InlineData(DocumentFileFormat.Json)]
    [InlineData(DocumentFileFormat.FigVam)]
    public async Task ImportPreservesContentAndIdsAsNewDurableBaseline(DocumentFileFormat format)
    {
        var document = Document(); var savedId = Guid.NewGuid();
        var source = new DocumentJsonExport(1, 37, new(savedId, "Source", DateTimeOffset.UtcNow, "source-owner", 37), document);
        var bytes = await File(source, format); var journal = Journal();
        var result = await Importer(journal).ImportAsync(new(format, new MemoryStream(bytes)), actor);
        Assert.Equal("ACCEPTED", result.Code); Assert.Equal(document.Id, result.DocumentId);
        journal = Journal(); // New storage instance recovers only durable state.
        var baseline = await journal.ReadAsync(document.Id);
        Assert.Equal(0, baseline!.Revision);
        Assert.Equal(JsonSerializer.Serialize(document), JsonSerializer.Serialize(baseline.Document));
        Assert.True(await journal.CanEditAsync(actor, document.Id, default));
        Assert.False(await journal.CanReadAsync(new("source-owner"), document.Id, default));
        Assert.Empty((await journal.ListVersionsAsync(document.Id, 10, null)).Versions!);
        Assert.Empty((await journal.ReadHistoryAsync(document.Id, actor.Id)).Entries!);
        Assert.Equal("VERSION_NOT_FOUND", (await journal.ReadVersionAsync(document.Id, savedId)).Code);
        Assert.Equal("INVALID_REVISION", (await journal.ReadAsync(document.Id, 37)).Code);
        var exporter = new DocumentJsonExporter(journal, journal, journal, new EmptyNodeProfile());
        Assert.Equal(DocumentJsonFormat.Serialize(new(1, 0, null, document)),
            (await exporter.ExportAsync(document.Id, null, null, actor)).Content);
        var pageId = Guid.NewGuid();
        var handler = new DocumentCommandHandler(journal, journal, new Profile());
        var added = await handler.HandleAsync(new AddPageCommand(document.Id, Guid.NewGuid(), pageId), actor);
        Assert.True(added.Accepted); Assert.Equal(1, added.Revision);
        var save = await handler.HandleAsync(new SaveDocumentCommand(document.Id, Guid.NewGuid(), "Local"), actor);
        Assert.True(save.Accepted);
        journal = Journal();
        var recovered = await journal.ReadAsync(document.Id);
        Assert.Equal(2, recovered!.Revision); Assert.Contains(recovered.Document.Pages, p => p.Id == pageId);
        Assert.Equal(2, (await journal.ReadEventsAsync(document.Id, 0)).Events!.Count);
        Assert.Equal(document.Id, (await journal.ReadVersionAsync(document.Id, save.VersionId!.Value)).Version!.Snapshot.Document.Id);
        var zip = await new DocumentContainerExporter(new DocumentJsonExporter(journal, journal, journal, new EmptyNodeProfile()), journal)
            .ExportAsync(document.Id, null, null, actor);
        Assert.Empty((await new DocumentFileReader(new Profile()).ReadContainerAsync(new MemoryStream(zip.Content!))).Diagnostics);
        Assert.True((await journal.SetMemberAsync(document.Id, "reviewer", DocumentRole.Viewer, actor)).Accepted);
    }

    [Fact]
    public async Task ExistingAndConcurrentIdsNeverReplaceStateOrMembership()
    {
        var journal = Journal(); var document = Document();
        var bytes = await File(new(1, 0, null, document), DocumentFileFormat.Json);
        var contenders = new[] { new DocumentActor("one"), new DocumentActor("two") };
        var results = await Task.WhenAll(contenders.Select(a => Importer(Journal()).ImportAsync(
            new(DocumentFileFormat.Json, new MemoryStream(bytes)), a)));
        Assert.Single(results, r => r.Code == "ACCEPTED"); Assert.Single(results, r => r.Code == "DOCUMENT_EXISTS");
        var winner = contenders[Array.FindIndex(results, r => r.Code == "ACCEPTED")];
        var loser = contenders.Single(a => a != winner);
        Assert.False(await journal.CanReadAsync(loser, document.Id, default));
        var handler = new DocumentCommandHandler(journal, journal, new Profile());
        Assert.True((await handler.HandleAsync(new AddPageCommand(document.Id, Guid.NewGuid(), Guid.NewGuid()), winner)).Accepted);
        var before = await journal.ReadAsync(document.Id);
        Assert.Equal("DOCUMENT_EXISTS", (await Importer(journal).ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(bytes)), actor)).Code);
        Assert.Equal(JsonSerializer.Serialize(before), JsonSerializer.Serialize(await journal.ReadAsync(document.Id)));
        Assert.False(await journal.CanReadAsync(actor, document.Id, default));
    }

    [Fact]
    public async Task OwnerWriteFailureRollsBackSnapshotAndAllowsLaterCleanImport()
    {
        var journal = Journal(); var document = Document();
        Assert.Null(await journal.ReadAsync(document.Id)); // Create empty storage schema for fault injection.
        using var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{document.Id:N}.sqlite")};Pooling=False");
        connection.Open(); using var sql = connection.CreateCommand();
        sql.CommandText = "CREATE TRIGGER fail_owner BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT,'injected failure'); END;";
        sql.ExecuteNonQuery();
        var bytes = await File(new(1, 0, null, document), DocumentFileFormat.Json);
        await Assert.ThrowsAsync<SqliteException>(() => Importer(journal).ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(bytes)), actor));
        Assert.Null(await Journal().ReadAsync(document.Id));
        Assert.False(await journal.CanReadAsync(actor, document.Id, default));
        sql.CommandText = "SELECT (SELECT COUNT(*) FROM snapshots)+(SELECT COUNT(*) FROM members)";
        Assert.Equal(0L, sql.ExecuteScalar());
        sql.CommandText = "DROP TRIGGER fail_owner"; sql.ExecuteNonQuery();
        Assert.Equal("ACCEPTED", (await Importer(journal).ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(bytes)), actor)).Code);
    }

    [Fact]
    public async Task InvalidUnsupportedAndUnauthorizedFilesDoNotCreateState()
    {
        var journal = Journal(); var importer = Importer(journal); var document = Document();
        var invalid = document with { Nodes = [document.Nodes[0] with { Kind = "unknown" }, document.Nodes[1]] };
        foreach (var (format, bytes) in new[] {
            (DocumentFileFormat.Json, Encoding.UTF8.GetBytes("{")),
            (DocumentFileFormat.Json, Encoding.UTF8.GetBytes("{\"schemaVersion\":2}")),
            (DocumentFileFormat.Json, DocumentJsonFormat.Serialize(new(1, 0, null, invalid))),
            (DocumentFileFormat.FigVam, new byte[] { 1, 2, 3 }) })
        {
            var result = await importer.ImportAsync(new(format, new MemoryStream(bytes)), actor);
            Assert.Equal("INVALID_DOCUMENT_FILE", result.Code); Assert.NotEmpty(result.Diagnostics!);
        }
        Assert.Empty(Directory.GetFiles(directory));
        var valid = DocumentJsonFormat.Serialize(new(1, 0, null, document));
        Assert.Equal("FORBIDDEN", (await importer.ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(valid)), new(" "))).Code);
        Assert.Empty(Directory.GetFiles(directory));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => importer.ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(valid)), actor, cancellation.Token));
        Assert.Empty(Directory.GetFiles(directory));
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
