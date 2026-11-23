using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

public sealed class DocumentContainerExportTests
{
    [Fact]
    public async Task ContainerContainsVerifiedDocumentAndStableSelectedVersions()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-container-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            var profile = new EmptyNodeProfile(); var journal = new SqliteDocumentJournal(directory, profile);
            Assert.True((await journal.CreateAsync(new(id), owner)).Accepted);
            var handler = new DocumentCommandHandler(journal, journal, profile);
            var json = new DocumentJsonExporter(journal, journal, journal, new EmptyNodeProfile());
            var exporter = new DocumentContainerExporter(json, journal);
            var first = await exporter.ExportAsync(id, 0, null, owner);
            Assert.Equal("OK", first.Code);
            Assert.Equal(first.Content, (await exporter.ExportAsync(id, 0, null, owner)).Content);
            using (var zip = new ZipArchive(new MemoryStream(first.Content!), ZipArchiveMode.Read))
            {
                Assert.Equal(new[] { "manifest.json", "document.json" }, zip.Entries.Select(e => e.FullName));
                using var manifestStream = zip.GetEntry("manifest.json")!.Open();
                var manifest = JsonNode.Parse(manifestStream)!;
                Assert.True(JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.CreateManifestFormat()), new BuildOptions { SchemaRegistry = new SchemaRegistry() }).EvaluateNode(manifest).IsValid);
                using var docStream = zip.GetEntry("document.json")!.Open(); using var bytes = new MemoryStream(); docStream.CopyTo(bytes);
                var document = bytes.ToArray(); var item = manifest["files"]![0]!;
                Assert.Equal(document.Length, item["size"]!.GetValue<int>());
                Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(document)), item["sha256"]!.GetValue<string>());
                Assert.Equal((await json.ExportAsync(id, 0, null, owner)).Content, document);
            }
            var save = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Review"), owner);
            var saved = await exporter.ExportAsync(id, null, save.VersionId, owner);
            Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), owner)).Accepted);
            Assert.Equal(first.Content, (await exporter.ExportAsync(id, 0, null, owner)).Content);
            Assert.Equal(saved.Content, (await exporter.ExportAsync(id, null, save.VersionId, owner)).Content);
            Assert.NotEqual(first.Content, (await exporter.ExportAsync(id, null, null, owner)).Content);
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, null, null, new("outsider"))).Code);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task DependencyFailureIsPropagatedWithoutArchive()
    {
        var result = await new DocumentContainerExporter(new Missing(), new EmptyAssetStore()).ExportAsync(Guid.NewGuid(), null, null, new("owner"));
        Assert.Equal("EXPORT_DEPENDENCY_UNAVAILABLE", result.Code); Assert.Null(result.Content);
    }
    private sealed class Missing : IDocumentJsonExporter
    {
        public Task<DocumentJsonExportResult> ExportAsync(Guid id, long? revision, Guid? version, DocumentActor actor, CancellationToken ct = default)
            => Task.FromResult(new DocumentJsonExportResult("EXPORT_DEPENDENCY_UNAVAILABLE"));
    }
}
