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
    public async Task SeparateProfileVersionSurvivesCreationReplaySavedVersionsAndBothImportFormats()
    {
        // This is an isolated test profile, not a production support declaration.
        var profile = new TestProfile(new("tests.empty-profile", 7));
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
            Assert.Equal(7, read.Document.Document.Profile.Version);
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
        var sourceProfile = new TestProfile(PortableUiProfileReference.Version1 with { Version = 7 });
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
    public async Task HttpReadsReportUnavailableProfileAndNewDocumentsUseVersion2()
    {
        var id = Guid.NewGuid();
        var sourceProfile = new TestProfile(PortableUiProfileReference.Version1 with { Version = 7 });
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
        var export = await client.GetFromJsonAsync<DocumentJsonExport>($"/api/v1/documents/{created}/document.json", DocumentJsonFormat.CreateOptions());
        Assert.Equal(PortableUiProfileReference.Version2, export!.Document.Profile);
        Assert.Empty(export.Document.Nodes);

        var legacyId = Guid.NewGuid();
        var legacy = new SqliteDocumentJournal(directory, new UnverifiedNodeProfile());
        Assert.True((await legacy.CreateAsync(new(legacyId), owner)).Accepted);
        var path = $"/api/v1/documents/{legacyId}";
        Assert.Equal(PortableUiProfileReference.Version1,
            (await client.GetFromJsonAsync<DocumentJsonExport>(path + "/document.json", DocumentJsonFormat.CreateOptions()))!.Document.Profile);
        using var upgrade = await client.PostAsJsonAsync(path + "/commands/upgrade-portable-ui-profile", new { commandId = Guid.NewGuid(), expectedRevision = 0 });
        Assert.Equal(200, (int)upgrade.StatusCode);
        Assert.Equal(PortableUiProfileReference.Version2,
            (await client.GetFromJsonAsync<DocumentJsonExport>(path + "/document.json", DocumentJsonFormat.CreateOptions()))!.Document.Profile);
        var metadata = (await client.GetFromJsonAsync<DocumentProfileResponse>(path + "/profile"))!;
        Assert.Equal(PortableUiProfileReference.Version2, metadata.Profile);
        Assert.Equal(5, metadata.Kinds.Count);
        var frame = Assert.Single(metadata.Kinds, kind => kind.Kind == "Frame");
        Assert.True(frame.CanContainChildren);
        Assert.IsType<NodeColorValue>(frame.Properties["backgroundColor"].DefaultValue);
        var originalMetadata = (await client.GetFromJsonAsync<DocumentProfileResponse>(path + "/profile?revision=0"))!;
        Assert.Equal(PortableUiProfileReference.Version1, originalMetadata.Profile);
        Assert.Empty(originalMetadata.Kinds);
    }

    [Fact]
    public async Task SchemaAndProfileVersionsHaveIndependentValidationAndProfileIsMandatory()
    {
        var bytes = DocumentJsonFormat.Serialize(new(1, 99, null, new(Guid.NewGuid(), [], [], [])));
        var json = JsonNode.Parse(bytes)!;
        var schema = JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentFormatSchemas.CreateDocumentFormat()),
            new BuildOptions { SchemaRegistry = new SchemaRegistry() });
        var reader = new DocumentFileReader(new VisualNodeProfile());
        json["document"]!["profile"]!["version"] = 7;
        Assert.True(schema.EvaluateNode(json).IsValid);
        Assert.Equal("UNSUPPORTED_PROFILE_VERSION", Assert.Single((await reader.ReadJsonAsync(new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(json)))).Diagnostics).Code);
        json["document"]!["profile"]!["version"] = 1;
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
