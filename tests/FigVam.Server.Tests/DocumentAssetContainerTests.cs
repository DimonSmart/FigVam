using System.Collections.Immutable;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentAssetContainerTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-asset-container-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner"), importer = new("importer");
    private readonly Profile profile = new();
    private SqliteDocumentJournal Journal(string sub) => new(Path.Combine(directory, sub), profile);
    private DocumentFileReader Reader() => new(profile);
    private DocumentContainerExporter Exporter(SqliteDocumentJournal journal) => new(new DocumentJsonExporter(journal, journal, journal, new FigVam.Server.Documents.UnverifiedNodeProfile()), journal);
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool IsKnownKind(string kind) => kind == "image";
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "source" ? new(NodePropertyType.Asset) : null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    }
    private static DocumentStructure Document()
    {
        var bytes = DocumentAssetTests.Png(); var assetId = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid();
        return new(Guid.NewGuid(), [new(Guid.NewGuid(), [screen])], [new(screen, [node], new(100, 100))],
            [new(node, "image", []) { Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("source", new NodeAssetValue(assetId)) }])
        { Assets = [SafeRasterImage.Inspect(assetId, "image/png", bytes)!] };
    }
    private static Dictionary<string, byte[]> Files(DocumentStructure document) => new() {
        ["document.json"] = DocumentJsonFormat.Serialize(new(1, 7, null, document)),
        [DocumentContainerFormat.AssetPath(document.Assets[0].Id)] = DocumentAssetTests.Png()
    };
    private static byte[] Archive(Dictionary<string, byte[]> files, Action<JsonNode>? changeManifest = null, Action<ZipArchive>? changeZip = null)
    {
        var manifest = JsonSerializer.SerializeToNode(new { schemaVersion = 1, files = files.Select(f => new {
            path = f.Key, size = f.Value.Length, sha256 = Convert.ToHexStringLower(SHA256.HashData(f.Value)) }) })!;
        changeManifest?.Invoke(manifest);
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            void Write(string path, byte[] bytes) { using var stream = zip.CreateEntry(path).Open(); stream.Write(bytes); }
            Write("manifest.json", JsonSerializer.SerializeToUtf8Bytes(manifest));
            foreach (var file in files) Write(file.Key, file.Value);
            changeZip?.Invoke(zip);
        }
        return output.ToArray();
    }

    [Fact]
    public async Task AssetRoundTripPreservesReferencesBytesAndImportingOwnerAfterReopen()
    {
        var document = Document(); var bytes = Archive(Files(document));
        var read = await Reader().ReadContainerAsync(new MemoryStream(bytes));
        Assert.Empty(read.Diagnostics); Assert.Equal(DocumentAssetTests.Png(), Assert.Single(read.Assets).Content);
        var journal = Journal("target");
        var result = await new DocumentFileImporter(Reader(), journal).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(bytes)), importer);
        Assert.Equal("ACCEPTED", result.Code);
        journal = Journal("target");
        var state = await journal.ReadAsync(document.Id);
        Assert.Equal(0, state!.Revision);
        Assert.Equal(DocumentJsonFormat.Serialize(new(1, 0, null, document)), DocumentJsonFormat.Serialize(new(1, 0, null, state.Document)));
        Assert.True(await journal.CanEditAsync(importer, document.Id, default));
        Assert.False(await journal.CanReadAsync(owner, document.Id, default));
        var content = await new DocumentAssets(journal, journal, journal, journal).ReadAsync(document.Id, document.Assets[0].Id, importer);
        Assert.Equal(DocumentAssetTests.Png(), content.Content!.Content);
        var exported = await Exporter(journal).ExportAsync(document.Id, null, null, importer);
        Assert.Equal("OK", exported.Code);
        Assert.Equal(exported.Content, (await Exporter(Journal("target")).ExportAsync(document.Id, 0, null, importer)).Content);
        Assert.Empty((await Reader().ReadContainerAsync(new MemoryStream(exported.Content!))).Diagnostics);
        var json = await new DocumentJsonExporter(journal, journal, journal, new FigVam.Server.Documents.UnverifiedNodeProfile()).ExportAsync(document.Id, null, null, importer);
        Assert.Equal("OK", json.Code);
        Assert.Contains((await Reader().ReadJsonAsync(new MemoryStream(json.Content!))).Diagnostics, d => d.Code == "MISSING_DEPENDENCY");
        Assert.Equal("DOCUMENT_EXISTS", (await new DocumentFileImporter(Reader(), journal).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(bytes)), owner)).Code);
        Assert.False(await journal.CanReadAsync(owner, document.Id, default));
    }

    [Fact]
    public async Task SelectedRevisionAndSavedVersionUseOnlyTheirOwnManifestAndRequireCurrentPermission()
    {
        var journal = Journal("source"); var id = Guid.NewGuid(); var asset = Guid.NewGuid();
        Assert.True((await journal.CreateAsync(new(id), owner)).Accepted);
        var handler = new DocumentCommandHandler(journal, journal, profile);
        var exporter = Exporter(journal);
        var empty = await exporter.ExportAsync(id, 0, null, owner);
        Assert.True((await handler.HandleAsync(new UploadDocumentAssetCommand(id, Guid.NewGuid(), asset, "image/png", DocumentAssetTests.Png()), owner)).Accepted);
        var revision = await exporter.ExportAsync(id, 1, null, owner);
        var save = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Image"), owner);
        var saved = await exporter.ExportAsync(id, null, save.VersionId, owner);
        Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(empty.Content, (await exporter.ExportAsync(id, 0, null, owner)).Content);
        Assert.Equal(revision.Content, (await exporter.ExportAsync(id, 1, null, owner)).Content);
        Assert.Equal(saved.Content, (await Exporter(Journal("source")).ExportAsync(id, null, save.VersionId, owner)).Content);
        var current = await Reader().ReadContainerAsync(new MemoryStream((await exporter.ExportAsync(id, null, null, owner)).Content!));
        Assert.Empty(current.Assets);
        var selected = await Reader().ReadContainerAsync(new MemoryStream(saved.Content!)); Assert.Single(selected.Assets);
        using (var zip = new ZipArchive(new MemoryStream(saved.Content!)))
            Assert.Equal(new[] { "manifest.json", "document.json", DocumentContainerFormat.AssetPath(asset) }, zip.Entries.Select(e => e.FullName));
        await journal.SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
        foreach (var actor in new[] { new DocumentActor("viewer"), new DocumentActor("outsider") })
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, null, save.VersionId, actor)).Code);
        await journal.SetMemberAsync(id, "editor", DocumentRole.Editor, owner);
        Assert.Equal("OK", (await exporter.ExportAsync(id, 1, null, new("editor"))).Code);
        await journal.RemoveMemberAsync(id, "editor", owner);
        Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, 1, null, new("editor"))).Code);
    }

    [Fact]
    public async Task MalformedAssetsAreRejectedBeforeCreatingAnyState()
    {
        var document = Document(); var path = DocumentContainerFormat.AssetPath(document.Assets[0].Id);
        async Task Error(Dictionary<string, byte[]> files, string code, Action<JsonNode>? manifest = null, Action<ZipArchive>? zip = null)
        {
            var bytes = Archive(files, manifest, zip);
            var result = await new DocumentFileImporter(Reader(), Journal("invalid")).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(bytes)), importer);
            Assert.Equal("INVALID_DOCUMENT_FILE", result.Code); Assert.Contains(result.Diagnostics!, d => d.Code == code);
        }
        var files = Files(document); files.Remove(path); await Error(files, "MISSING_DEPENDENCY");
        await Error(Files(document), "HASH_MISMATCH", m => m["files"]![1]!["sha256"] = new string('0', 64));
        await Error(Files(document), "SIZE_MISMATCH", m => m["files"]![1]!["size"] = 1);
        await Error(Files(document), "DUPLICATE_ENTRY", m => m["files"]!.AsArray().Add(m["files"]![1]!.DeepClone()));
        await Error(Files(document), "MISSING_DEPENDENCY", m => m["files"]!.AsArray().RemoveAt(1));
        files = Files(document); files[path] = DocumentAssetTests.Png(raw: [0, 0, 0, 255, 255, 0, 0]); await Error(files, "INVALID_ASSET");
        foreach (var invalid in DocumentAssetTests.InvalidPngs())
        { files = Files(document); files[path] = invalid; await Error(files, "INVALID_ASSET"); }
        files = Files(document); files[DocumentContainerFormat.AssetPath(Guid.NewGuid())] = DocumentAssetTests.Png(); await Error(files, "UNREFERENCED_ASSET");
        files = Files(document); files["assets/../bad.png"] = []; await Error(files, "UNSAFE_ENTRY_PATH");
        await Error(Files(document), "UNSAFE_ENTRY_TYPE", zip: z => z.CreateEntry(DocumentContainerFormat.AssetPath(Guid.NewGuid())).ExternalAttributes = 0xA000 << 16);
        var missingReference = document with { Assets = [] };
        files = Files(document); files["document.json"] = DocumentJsonFormat.Serialize(new(1, 7, null, missingReference));
        await Error(files, "missing-reference");
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, "invalid")));
    }

    private sealed class Source(DocumentStructure document) : IDocumentJsonExporter
    {
        public Task<DocumentJsonExportResult> ExportAsync(Guid id, long? revision, Guid? versionId, DocumentActor actor, CancellationToken cancellationToken = default)
            => Task.FromResult(new DocumentJsonExportResult("OK", DocumentJsonFormat.Serialize(new(1, 7, null, document))));
    }
    private sealed class ContentStore(byte[]? bytes) : IDocumentAssetStore
    {
        public Task<byte[]?> ReadAssetContentAsync(Guid id, DocumentAsset asset, CancellationToken cancellationToken = default)
            => Task.FromResult(bytes);
    }

    [Fact]
    public async Task MissingTamperedAndUnsafeStoredAssetsFailExportWithoutPartialArchive()
    {
        var document = Document();
        foreach (var content in new byte[]?[] { null, [0], DocumentAssetTests.Png(raw: [0, 0, 0, 255, 255, 0, 0]) })
        {
            var export = await new DocumentContainerExporter(new Source(document), new ContentStore(content)).ExportAsync(document.Id, null, null, owner);
            Assert.Equal("EXPORT_DEPENDENCY_UNAVAILABLE", export.Code); Assert.Null(export.Content);
        }
        var journal = Journal("corrupt");
        Assert.Equal("ACCEPTED", (await new DocumentFileImporter(Reader(), journal).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(Archive(Files(document)))), importer)).Code);
        using var connection = new SqliteConnection($"Data Source={Path.Combine(directory, "corrupt", $"{document.Id:N}.sqlite")};Pooling=False");
        connection.Open(); using var sql = connection.CreateCommand(); sql.CommandText = "DELETE FROM asset_content"; sql.ExecuteNonQuery();
        var result = await Exporter(journal).ExportAsync(document.Id, null, null, importer);
        Assert.Equal("EXPORT_DEPENDENCY_UNAVAILABLE", result.Code); Assert.Null(result.Content);
    }

    [Fact]
    public async Task AssetPathsHaveDeterministicOrderAndArchiveLimitsApplyToAssets()
    {
        var document = Document();
        var first = document.Assets[0] with { Id = Guid.Parse("11111111-1111-1111-1111-111111111111") };
        var second = first with { Id = Guid.Parse("22222222-2222-2222-2222-222222222222") };
        document = document with { Assets = [second, first], Nodes = [], Pages = [], Screens = [] };
        var exporter = new DocumentContainerExporter(new Source(document), new ContentStore(DocumentAssetTests.Png()));
        var result = await exporter.ExportAsync(document.Id, null, null, owner);
        Assert.Equal(result.Content, (await exporter.ExportAsync(document.Id, null, null, owner)).Content);
        using (var zip = new ZipArchive(new MemoryStream(result.Content!)))
            Assert.Equal(new[] { "manifest.json", "document.json", DocumentContainerFormat.AssetPath(first.Id), DocumentContainerFormat.AssetPath(second.Id) }, zip.Entries.Select(e => e.FullName));
        Assert.Equal(2, (await Reader().ReadContainerAsync(new MemoryStream(result.Content!))).Assets.Count);
        var files = Files(Document());
        files[files.Keys.Single(k => k.StartsWith("assets/"))] = new byte[DocumentAssetValidator.MaxAssetBytes + 1];
        Assert.Contains((await Reader().ReadContainerAsync(new MemoryStream(Archive(files)))).Diagnostics, d => d.Code == "FILE_TOO_LARGE");
        files = new() { ["document.json"] = DocumentJsonFormat.Serialize(new(1, 0, null, document with { Assets = [] })) };
        for (var i = 0; i < DocumentFileReader.MaxEntries; i++) files[DocumentContainerFormat.AssetPath(Guid.NewGuid())] = [];
        Assert.Contains((await Reader().ReadContainerAsync(new MemoryStream(Archive(files)))).Diagnostics, d => d.Code == "ENTRY_LIMIT");
    }

    [Theory]
    [InlineData("contentType")]
    [InlineData("sha256")]
    [InlineData("byteLength")]
    [InlineData("width")]
    [InlineData("height")]
    public async Task DocumentAssetMetadataMustMatchValidatedContent(string property)
    {
        var document = Document();
        var files = Files(document);
        var json = JsonNode.Parse(files["document.json"])!;
        var asset = json["document"]!["assets"]![0]!;
        asset[property] = property switch
        {
            "contentType" => JsonValue.Create("image/svg+xml"),
            "sha256" => JsonValue.Create(new string('0', 64)),
            _ => JsonValue.Create(asset[property]!.GetValue<int>() + 1)
        };
        files["document.json"] = JsonSerializer.SerializeToUtf8Bytes(json);
        var result = await new DocumentFileImporter(Reader(), Journal("metadata")).ImportAsync(
            new(DocumentFileFormat.FigVam, new MemoryStream(Archive(files))), importer);
        Assert.Equal("INVALID_DOCUMENT_FILE", result.Code);
        Assert.NotEmpty(result.Diagnostics!);
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, "metadata")));
    }

    [Theory]
    [InlineData("snapshots")]
    [InlineData("members")]
    [InlineData("asset_content")]
    public async Task AnyStorageFailureRollsBackAssetsSnapshotAndOwner(string table)
    {
        var document = Document(); var journal = Journal("rollback");
        Assert.Null(await journal.ReadAsync(document.Id));
        using var connection = new SqliteConnection($"Data Source={Path.Combine(directory, "rollback", $"{document.Id:N}.sqlite")};Pooling=False");
        connection.Open(); using var sql = connection.CreateCommand();
        sql.CommandText = $"CREATE TRIGGER fail_import BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'injected failure'); END;"; sql.ExecuteNonQuery();
        var bytes = Archive(Files(document));
        await Assert.ThrowsAsync<SqliteException>(() => new DocumentFileImporter(Reader(), journal).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(bytes)), importer));
        sql.CommandText = "SELECT (SELECT COUNT(*) FROM snapshots)+(SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM asset_content)";
        Assert.Equal(0L, sql.ExecuteScalar());
        Assert.Null(await journal.ReadAsync(document.Id)); Assert.False(await journal.CanReadAsync(importer, document.Id, default));
        sql.CommandText = "DROP TRIGGER fail_import"; sql.ExecuteNonQuery();
        Assert.Equal("ACCEPTED", (await new DocumentFileImporter(Reader(), journal).ImportAsync(new(DocumentFileFormat.FigVam, new MemoryStream(bytes)), importer)).Code);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
