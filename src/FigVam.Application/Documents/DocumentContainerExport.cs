using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public interface IDocumentContainerExporter
{
    Task<DocumentJsonExportResult> ExportAsync(Guid documentId, long? revision, Guid? versionId,
        DocumentActor actor, CancellationToken cancellationToken = default);
}

public sealed class DocumentContainerExporter(IDocumentJsonExporter documents, IDocumentAssetStore assets) : IDocumentContainerExporter
{
    public async Task<DocumentJsonExportResult> ExportAsync(Guid documentId, long? revision, Guid? versionId,
        DocumentActor actor, CancellationToken cancellationToken = default)
    {
        DocumentJsonExportResult result;
        try { result = await documents.ExportAsync(documentId, revision, versionId, actor, cancellationToken); }
        catch (InvalidDataException) { return new("EXPORT_DEPENDENCY_UNAVAILABLE"); }
        if (result.Content is not { } document) return result;
        var snapshot = JsonSerializer.Deserialize<DocumentJsonExport>(document, DocumentJsonFormat.CreateOptions())!;
        if (!DocumentAssetValidator.IsValid(snapshot.Document.Assets)) return new("EXPORT_DEPENDENCY_UNAVAILABLE");
        var files = new List<(string Path, byte[] Content)> { ("document.json", document) };
        foreach (var asset in snapshot.Document.Assets.OrderBy(a => a.Id))
        {
            byte[]? content;
            try { content = await assets.ReadAssetContentAsync(documentId, asset, cancellationToken); }
            catch (InvalidDataException) { return new("EXPORT_DEPENDENCY_UNAVAILABLE"); }
            if (content is null || DocumentAssetContentFormat.Inspect(asset.Id, asset.ContentType, content) != asset)
                return new("EXPORT_DEPENDENCY_UNAVAILABLE");
            files.Add((DocumentContainerFormat.AssetPath(asset), content));
        }
        var manifest = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = 1,
            files = files.Select(file => new { path = file.Path, size = file.Content.Length,
                sha256 = Convert.ToHexStringLower(SHA256.HashData(file.Content)) })
        });
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, "manifest.json", manifest);
            foreach (var file in files) Write(zip, file.Path, file.Content);
        }
        cancellationToken.ThrowIfCancellationRequested();
        return new("OK", output.ToArray());
    }

    private static void Write(ZipArchive zip, string name, byte[] content)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.NoCompression);
        entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
        using var stream = entry.Open();
        stream.Write(content);
    }
}
