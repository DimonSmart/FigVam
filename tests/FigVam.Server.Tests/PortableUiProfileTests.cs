using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Json;
using System.Security.Cryptography;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class PortableUiProfileTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-profile-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner");
    private sealed class TestProfile(PortableUiProfileReference identity) : INodeProfile
    {
        public PortableUiProfileReference Identity => identity;
        public bool IsKnownKind(string kind) => false;
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent value) => false;
        public bool SupportsPreviewAction(PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    }

    [Fact]
    public async Task CurrentProfileSurvivesCreationReplaySavedVersionsAndBothImportFormats()
    {
        var profile = new EmptyNodeProfile();
        var id = Guid.NewGuid();
        var journal = new SqliteDocumentJournal(directory, profile);
        Assert.True((await journal.CreateAsync(new(id), owner)).Accepted);
        var handler = new DocumentCommandHandler(journal, journal, profile);
        Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), owner)).Accepted);
        var saved = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Review"), owner);
        Assert.True(saved.Accepted);
        Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), owner)).Accepted);

        var reopened = new SqliteDocumentJournal(directory, profile);
        Assert.Equal(profile.Identity, (await reopened.ReadAsync(id))!.Document.Profile);
        Assert.Equal(profile.Identity, (await reopened.ReadAsync(id, 1)).State!.Document.Profile);
        Assert.Equal(profile.Identity, (await reopened.ReadVersionAsync(id, saved.VersionId!.Value)).Version!.Snapshot.Document.Profile);
        var exporter = new DocumentJsonExporter(reopened, reopened, reopened, profile);
        var fileReader = new DocumentFileReader(profile);
        var containers = new DocumentContainerExporter(exporter, reopened);
        foreach (var version in new Guid?[] { null, saved.VersionId })
        {
            var json = await exporter.ExportAsync(id, null, version, owner);
            Assert.Equal("OK", json.Code);
            Assert.Equal(json.Content, (await exporter.ExportAsync(id, null, version, owner)).Content);
            var read = await fileReader.ReadJsonAsync(new MemoryStream(json.Content!));
            Assert.Empty(read.Diagnostics);
            Assert.Equal(1, read.Document!.SchemaVersion);
            Assert.Equal(PortableUiProfileReference.Current, read.Document.Document.Profile);
            Assert.Equal(version, read.Document.SavedVersion?.Id);
            Assert.Equal(version.HasValue ? saved.Revision : 3, read.Document.Revision);
            Assert.Equal(json.Content, DocumentJsonFormat.Serialize(read.Document));
            var zip = await containers.ExportAsync(id, null, version, owner);
            Assert.Equal(zip.Content, (await containers.ExportAsync(id, null, version, owner)).Content);
            var containerRead = await fileReader.ReadContainerAsync(new MemoryStream(zip.Content!));
            Assert.Empty(containerRead.Diagnostics);
            Assert.Equal(json.Content, DocumentJsonFormat.Serialize(containerRead.Document!));

            foreach (var format in new[] { DocumentFileFormat.Json, DocumentFileFormat.FigVam })
            {
                var target = new SqliteDocumentJournal(Path.Combine(directory, Guid.NewGuid().ToString()), profile);
                var import = await new DocumentFileImporter(fileReader, target).ImportAsync(
                    new(format, new MemoryStream(format == DocumentFileFormat.Json ? json.Content! : zip.Content!)), owner);
                Assert.Equal("ACCEPTED", import.Code);
                var imported = await target.ReadAsync(id);
                Assert.Equal(0, imported!.Revision);
                Assert.Equal(profile.Identity, imported.Document.Profile);
            }
        }
    }

    [Theory]
    [InlineData("unknown", 1, "PROFILE_UNAVAILABLE")]
    [InlineData("figvam.portable-ui", 7, "UNSUPPORTED_PROFILE_VERSION")]
    public async Task ReaderAndAtomicImportRejectUnavailableProfileWithSpecificDiagnostic(string id, int version, string code)
    {
        var profile = new VisualNodeProfile();
        var doc = new DocumentStructure(Guid.NewGuid(), [], [], []) { Profile = new(id, version) };
        var bytes = DocumentJsonFormat.Serialize(new(1, 42, null, doc));
        var reader = new DocumentFileReader(profile);
        var result = await reader.ReadJsonAsync(new MemoryStream(bytes));
        Assert.Null(result.Document);
        var error = Assert.Single(result.Diagnostics);
        Assert.Equal(code, error.Code);
        Assert.Equal("/document/profile", error.Path);
        var container = await DocumentFileImportTests.File(new(1, 42, null, doc), DocumentFileFormat.FigVam);
        var containerRead = await reader.ReadContainerAsync(new MemoryStream(container));
        Assert.Null(containerRead.Document);
        Assert.Equal(code, Assert.Single(containerRead.Diagnostics).Code);
        var journal = new SqliteDocumentJournal(directory, profile);
        var imported = await new DocumentFileImporter(reader, journal).ImportAsync(new(DocumentFileFormat.Json, new MemoryStream(bytes)), owner);
        Assert.Equal("INVALID_DOCUMENT_FILE", imported.Code);
        Assert.Equal(code, Assert.Single(imported.Diagnostics!).Code);
        Assert.Null(await journal.ReadAsync(doc.Id));
        Assert.Equal(code, Assert.Single(DocumentStructureValidator.Validate(doc, profile)).Code);
    }

    [Fact]
    public async Task ProductionCannotReadRecoverExportOrSaveDocumentsFromUnavailableVersion()
    {
        var id = Guid.NewGuid();
        var sourceProfile = new TestProfile(PortableUiProfileReference.Current with { Version = 7 });
        var source = new SqliteDocumentJournal(directory, sourceProfile);
        await source.CreateAsync(new(id), owner);
        var saved = await new DocumentCommandHandler(source, source, sourceProfile)
            .HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), owner);
        var currentProfile = new VisualNodeProfile();
        var current = new SqliteDocumentJournal(directory, currentProfile);
        var failures = new Func<Task>[]
        {
            async () => { await current.ReadAsync(id); },
            async () => { await current.ReadAsync(id, 0); },
            async () => { await current.ReadVersionAsync(id, saved.VersionId!.Value); },
            async () => { await new DocumentJsonExporter(current, current, current, currentProfile).ExportAsync(id, null, null, owner); },
            async () => { await new DocumentCommandHandler(current, current, currentProfile).HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), owner); }
        };
        foreach (var read in failures)
            Assert.Equal("UNSUPPORTED_PROFILE_VERSION", (await Assert.ThrowsAsync<PortableUiProfileException>(read)).Code);
        Assert.Equal(1, (await source.ReadAsync(id))!.Revision);
        Assert.Equal(sourceProfile.Identity, (await source.ReadAsync(id))!.Document.Profile);
    }

    [Fact]
    public async Task HttpReadsReportUnavailableProfileAndNewDocumentsUseCurrentProfile()
    {
        var id = Guid.NewGuid();
        var sourceProfile = new TestProfile(PortableUiProfileReference.Current with { Version = 7 });
        var source = new SqliteDocumentJournal(directory, sourceProfile);
        await source.CreateAsync(new(id), owner);
        var saved = await new DocumentCommandHandler(source, source, sourceProfile)
            .HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), owner);
        using var key = RSA.Create(2048);
        var config = ServerTestIdentity.Production(key);
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: owner.Id));
        foreach (var route in new[] { "document.json", "document.json?revision=0", "document.json?versionId=" + saved.VersionId, "container.figvam" })
        {
            using var response = await client.GetAsync($"/api/v1/documents/{id}/{route}");
            Assert.Equal(400, (int)response.StatusCode);
            Assert.Equal("UNSUPPORTED_PROFILE_VERSION", (await response.Content.ReadFromJsonAsync<ApiError>())!.Code);
        }
        var created = Guid.NewGuid();
        Assert.Equal(201, (int)(await client.PostAsJsonAsync("/api/v1/documents", new { documentId = created })).StatusCode);
        // Simulate a database created before catalog metadata was introduced.
        using (var db = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False"))
        {
            db.Open();
            using var sql = db.CreateCommand();
            sql.CommandText = "DROP TABLE document_metadata";
            sql.ExecuteNonQuery();
        }
        var list = (await client.GetFromJsonAsync<DocumentListResponse>("/api/v1/documents"))!;
        Assert.Equal(2, list.Items.Count);
        var old = Assert.Single(list.Items, item => item.DocumentId == id);
        Assert.Equal(7, old.ProfileVersion);
        Assert.Equal("UNSUPPORTED_PROFILE_VERSION", old.CompatibilityIssue);
        Assert.Equal(1, old.Revision);
        Assert.Null(old.CreatedAt);
        Assert.Null(Assert.Single(list.Items, item => item.DocumentId == created).CompatibilityIssue);
        await source.SetMemberAsync(id, "viewer", DocumentRole.Viewer, owner);
        var deletion = new { commandId = Guid.NewGuid(), expectedRevision = old.Revision };
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "viewer"));
        Assert.Equal(403, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/delete-document", deletion)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: owner.Id));
        Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/delete-document", deletion)).StatusCode);
        Assert.Equal(200, (int)(await client.PostAsJsonAsync($"/api/v1/documents/{id}/commands/delete-document", deletion)).StatusCode);
        Assert.Equal(created, Assert.Single((await client.GetFromJsonAsync<DocumentListResponse>("/api/v1/documents"))!.Items).DocumentId);

        var export = await client.GetFromJsonAsync<DocumentJsonExport>($"/api/v1/documents/{created}/document.json", DocumentJsonFormat.CreateOptions());
        Assert.Equal(PortableUiProfileReference.Current, export!.Document.Profile);
        Assert.Empty(export.Document.Nodes);

        var metadata = (await client.GetFromJsonAsync<DocumentProfileResponse>(
            $"/api/v1/documents/{created}/profile"))!;
        Assert.Equal(PortableUiProfileReference.Current, metadata.Profile);
        Assert.Equal(5, metadata.Kinds.Count);
        var input = Assert.Single(metadata.Kinds, kind => kind.Kind == "TextInput");
        Assert.True(input.Properties.ContainsKey("inputType"));
    }

    [Fact]
    public async Task LegacyCatalogReportsLastHistoricalProfileUpgradeWithoutReplayingIt()
    {
        var id = Guid.NewGuid();
        var oldProfile = new TestProfile(new("figvam.portable-ui", 2));
        var source = new SqliteDocumentJournal(directory, oldProfile);
        Assert.True((await source.CreateAsync(new(id, "Old design"), owner)).Accepted);
        // This is the event shape emitted by the former upgrade-portable-ui-profile command.
        using (var db = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False"))
        {
            db.Open();
            using var sql = db.CreateCommand();
            sql.CommandText = """
                DROP TABLE document_metadata;
                INSERT INTO events(revision,command_id,actor_id,timestamp,type,subject_id)
                VALUES(1,$command,$actor,$time,'UPGRADE_PORTABLE_UI_PROFILE',$id);
                INSERT INTO payload_events(revision,payload) VALUES(1,$payload);
                """;
            sql.Parameters.AddWithValue("$command", Guid.NewGuid().ToString());
            sql.Parameters.AddWithValue("$actor", owner.Id);
            sql.Parameters.AddWithValue("$time", DateTimeOffset.UtcNow.ToString("O"));
            sql.Parameters.AddWithValue("$id", id.ToString());
            sql.Parameters.AddWithValue("$payload", """{"payloadType":"PORTABLE_UI_PROFILE_UPGRADED","Profile":{"Id":"figvam.portable-ui","Version":3}}""");
            sql.ExecuteNonQuery();
        }
        var current = new SqliteDocumentJournal(directory, new VisualNodeProfile());
        var item = Assert.Single((await current.ListAsync(owner)).Items);
        Assert.Equal(3, item.ProfileVersion);
        Assert.Equal(1, item.Revision);
        Assert.Equal("Old design", item.Name);
        Assert.Equal("UNSUPPORTED_PROFILE_VERSION", item.CompatibilityIssue);
        Assert.True((await new DocumentCommandHandler(current, current, new VisualNodeProfile())
            .HandleAsync(new DeleteDocumentCommand(id, Guid.NewGuid(), 1), owner)).Accepted);
        Assert.Empty((await current.ListAsync(owner)).Items);
    }

    [Fact]
    public async Task SchemaAndCurrentProfileAreValidatedAndProfileIsMandatory()
    {
        var bytes = DocumentJsonFormat.Serialize(new(1, 99, null, new(Guid.NewGuid(), [], [], [])));
        var json = JsonNode.Parse(bytes)!;
        var schema = JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentFormatSchemas.CreateDocumentFormat()),
            new BuildOptions { SchemaRegistry = new SchemaRegistry() });
        var reader = new DocumentFileReader(new VisualNodeProfile());
        json["document"]!["profile"]!["version"] = 7;
        Assert.False(schema.EvaluateNode(json).IsValid);
        Assert.Equal("UNSUPPORTED_PROFILE_VERSION", Assert.Single((await reader.ReadJsonAsync(new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(json)))).Diagnostics).Code);
        json["document"]!["profile"]!["version"] = PortableUiProfileReference.Current.Version;
        json["schemaVersion"] = 7;
        Assert.False(schema.EvaluateNode(json).IsValid);
        Assert.Equal("UNSUPPORTED_SCHEMA_VERSION", Assert.Single((await reader.ReadJsonAsync(new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(json)))).Diagnostics).Code);
        json["schemaVersion"] = 1;
        foreach (var field in new[] { "id", "version" })
        {
            var missing = json.DeepClone();
            missing["document"]!["profile"]!.AsObject().Remove(field);
            Assert.False(schema.EvaluateNode(missing).IsValid);
        }
        json["document"]!.AsObject().Remove("profile");
        Assert.False(schema.EvaluateNode(json).IsValid);
        Assert.Equal("INVALID_SCHEMA", Assert.Single((await reader.ReadJsonAsync(new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(json)))).Diagnostics).Code);
        Assert.Throws<JsonException>(() => json.Deserialize<DocumentJsonExport>(DocumentJsonFormat.CreateOptions()));
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
