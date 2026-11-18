using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Domain.Documents;
using Json.Schema;

namespace FigVam.Application.Documents;

public sealed record DocumentReadDiagnostic(string Code, string Path, string Message,
    Guid? ObjectId = null, Guid? ReferenceId = null, string? Property = null);
public sealed record DocumentReadResult(DocumentJsonExport? Document, IReadOnlyList<DocumentReadDiagnostic> Diagnostics)
{
    public IReadOnlyList<DocumentAssetContent> Assets { get; init; } = [];
}

public interface IDocumentFileReader
{
    Task<DocumentReadResult> ReadJsonAsync(Stream input, CancellationToken cancellationToken = default);
    Task<DocumentReadResult> ReadContainerAsync(Stream input, CancellationToken cancellationToken = default);
}

// Reads untrusted files into an isolated value; no authorization, journal or database dependency.
public sealed class DocumentFileReader(INodeProfile profile) : IDocumentFileReader
{
    public const int MaxJsonDepth = 64;
    public const int MaxContainerBytes = DocumentJsonFormat.MaxBytes + (int)DocumentAssetValidator.MaxDocumentBytes + 256 * 1024;
    public const int MaxManifestBytes = 64 * 1024;
    public const int MaxEntries = DocumentAssetValidator.MaxAssets + 2;
    public const int MaxNodes = 1000;
    public const int MaxTreeDepth = 128;
    private const int MaxJsonValues = 100_000;
    private static readonly JsonSchema DocumentSchema = Build(DocumentFormatSchemas.CreateDocumentFormat());
    private static readonly JsonSchema ManifestSchema = Build(DocumentFormatSchemas.CreateManifestFormat());
    private static JsonSchema Build(JsonNode schema) => JsonSchema.Build(JsonSerializer.SerializeToElement(schema),
        new BuildOptions { SchemaRegistry = new SchemaRegistry() });

    public async Task<DocumentReadResult> ReadJsonAsync(Stream input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        try { return ParseDocument(await ReadBounded(input, DocumentJsonFormat.MaxBytes, cancellationToken), cancellationToken); }
        catch (FileLimitException) { return Failure("FILE_TOO_LARGE", "document.json", "Document exceeds the size limit."); }
        catch (IOException) { return Failure("INVALID_FILE", "document.json", "Document could not be read."); }
    }

    public async Task<DocumentReadResult> ReadContainerAsync(Stream input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        try
        {
            var content = await ReadBounded(input, MaxContainerBytes, cancellationToken);
            using var zip = new ZipArchive(new MemoryStream(content, writable: false), ZipArchiveMode.Read);
            if (zip.Entries.Count > MaxEntries) return Failure("ENTRY_LIMIT", "", "Container has too many entries.");
            var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
            long expanded = 0, compressed = 0;
            foreach (var entry in zip.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var path = entry.FullName;
                if (path.Length == 0 || path.Contains('\\') || path.Contains(':') || path.StartsWith('/') ||
                    path.Split('/').Any(part => part is "" or "." or "..") || path.Any(char.IsControl))
                    return Failure("UNSAFE_ENTRY_PATH", "", "Container contains an unsafe entry path.");
                if (!entries.TryAdd(path, entry)) return Failure("DUPLICATE_ENTRY", "", "Container contains duplicate entry paths.");
                if (path is not "manifest.json" and not "document.json" && !DocumentContainerFormat.IsAssetPath(path))
                    return Failure("UNSUPPORTED_ENTRY", "", "Entry is not supported by this container version.");
                var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
                if (unixType is not 0 and not 0x8000 || (entry.ExternalAttributes & 0x10) != 0)
                    return Failure("UNSAFE_ENTRY_TYPE", path, "Only regular file entries are supported.");
                var limit = path == "manifest.json" ? MaxManifestBytes : path == "document.json" ? DocumentJsonFormat.MaxBytes : DocumentAssetValidator.MaxAssetBytes;
                if (entry.Length < 0 || entry.Length > limit || entry.CompressedLength < 0 || entry.CompressedLength > MaxContainerBytes)
                    throw new FileLimitException();
                expanded += entry.Length; compressed += entry.CompressedLength;
                if (expanded > DocumentJsonFormat.MaxBytes + MaxManifestBytes + DocumentAssetValidator.MaxDocumentBytes || compressed > MaxContainerBytes) throw new FileLimitException();
            }
            if (!entries.ContainsKey("manifest.json") || !entries.ContainsKey("document.json"))
                return Failure("MISSING_DEPENDENCY", "", "Container requires manifest.json and document.json.");
            using var manifestStream = entries["manifest.json"].Open();
            var manifestBytes = await ReadBounded(manifestStream, MaxManifestBytes, cancellationToken);
            if (manifestBytes.LongLength != entries["manifest.json"].Length) return Failure("SIZE_MISMATCH", "manifest.json", "Entry size does not match its ZIP declaration.");
            var manifest = ParseJson(manifestBytes);
            if (manifest is null) return Failure("INVALID_JSON", "manifest.json", "Manifest JSON is malformed or exceeds limits.");
            if (manifest["schemaVersion"]?.ToJsonString() != "1") return Failure("UNSUPPORTED_SCHEMA_VERSION", "manifest.json", "Only schema version 1 is supported.");
            if (!ManifestSchema.Evaluate(JsonSerializer.SerializeToElement(manifest)).IsValid) return Failure("INVALID_SCHEMA", "manifest.json", "Manifest does not match the published schema.");
            var declared = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var contents = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            foreach (var file in manifest["files"]!.AsArray())
            {
                var path = file!["path"]!.GetValue<string>();
                if (!declared.Add(path)) return Failure("DUPLICATE_ENTRY", path, "Manifest contains duplicate paths.");
                if (!entries.TryGetValue(path, out var entry) || entry.FullName != path)
                    return Failure("MISSING_DEPENDENCY", path, "A declared file is missing.");
                using var stream = entry.Open();
                var bytes = await ReadBounded(stream, path == "document.json" ? DocumentJsonFormat.MaxBytes : DocumentAssetValidator.MaxAssetBytes, cancellationToken);
                if (bytes.LongLength != entry.Length || bytes.LongLength != file["size"]!.GetValue<double>())
                    return Failure("SIZE_MISMATCH", path, "File size does not match its manifest or ZIP declaration.");
                if (Convert.ToHexStringLower(SHA256.HashData(bytes)) != file["sha256"]!.GetValue<string>())
                    return Failure("HASH_MISMATCH", path, "File hash does not match its manifest.");
                contents.Add(path, bytes);
            }
            if (!contents.ContainsKey("document.json") || declared.Count != entries.Count - 1)
                return Failure("MISSING_DEPENDENCY", "manifest.json", "Manifest must list every content file exactly once.");
            var parsed = ParseDocument(contents["document.json"], cancellationToken, allowAssets: true);
            if (parsed.Document is null) return parsed;
            var assets = new List<DocumentAssetContent>();
            foreach (var asset in parsed.Document.Document.Assets)
            {
                var path = DocumentContainerFormat.AssetPath(asset.Id);
                if (!contents.TryGetValue(path, out var bytes)) return Failure("MISSING_DEPENDENCY", path, "Document asset content is missing.");
                if (SafeRasterImage.Inspect(asset.Id, asset.ContentType, bytes) != asset)
                    return Failure("INVALID_ASSET", path, "Asset content does not match its safe raster metadata and hash.");
                assets.Add(new(asset, bytes));
            }
            if (contents.Count != assets.Count + 1)
                return Failure("UNREFERENCED_ASSET", "manifest.json", "Container assets must belong to the document manifest.");
            return parsed with { Assets = assets };

        }
        catch (FileLimitException) { return Failure("FILE_TOO_LARGE", "", "Container exceeds a compressed or expanded size limit."); }
        catch (InvalidDataException) { return Failure("INVALID_CONTAINER", "", "Container ZIP data is invalid or unsupported."); }
        catch (IOException) { return Failure("INVALID_FILE", "", "Container could not be read."); }
        catch (JsonException) { return Failure("INVALID_JSON", "manifest.json", "Manifest JSON is invalid."); }
    }

    private DocumentReadResult ParseDocument(byte[] bytes, CancellationToken cancellationToken, bool allowAssets = false)
    {
        try
        {
            var json = ParseJson(bytes);
            if (json is null) return Failure("INVALID_JSON", "document.json", "JSON is malformed, contains duplicate properties or exceeds limits.");
            if (json["schemaVersion"]?.ToJsonString() != "1") return Failure("UNSUPPORTED_SCHEMA_VERSION", "/schemaVersion", "Only schema version 1 is supported.");
            if (!DocumentSchema.Evaluate(JsonSerializer.SerializeToElement(json)).IsValid) return Failure("INVALID_SCHEMA", "document.json", "Document does not match the published schema.");
            if (json["document"]!["tokens"]!.AsArray().Any(token => token!["values"]!.AsObject().Any(value => value.Key is not "Light" and not "Dark")))
                return Failure("INVALID_SCHEMA", "/document/tokens", "Token themes must use the declared theme names.");
            if (!allowAssets && HasAssetReference(json["document"]!)) return Failure("MISSING_DEPENDENCY", "/document", "Standalone JSON cannot supply asset content; reopen the complete .figvam container.");
            var options = DocumentJsonFormat.CreateOptions();
            options.PropertyNameCaseInsensitive = false;
            options.RespectNullableAnnotations = true;
            options.MaxDepth = MaxJsonDepth;
            var export = json.Deserialize<DocumentJsonExport>(options)!;
            var doc = export.Document;
            if (PortableUiProfileResolver.Validate(doc.Profile, profile) is { } profileError)
                return Failure(profileError.Code, "/document/profile", profileError.Message);
            if (doc.Nodes.Count > MaxNodes || doc.Pages.Count > MaxNodes || doc.Screens.Count > MaxNodes ||
                doc.ComponentDefinitions.Count > MaxNodes || doc.ComponentInstances.Count > MaxNodes || doc.Tokens.Count > MaxNodes)
                return Failure("DOCUMENT_LIMIT", "/document", "Document exceeds object count limits.");
            if (export.SavedVersion is { } saved && (saved.Id == Guid.Empty || saved.Revision != export.Revision || string.IsNullOrWhiteSpace(saved.AuthorId)))
                return Failure("INVALID_SAVED_VERSION", "/savedVersion", "Saved-version metadata is inconsistent.");
            cancellationToken.ThrowIfCancellationRequested();
            if (!allowAssets && doc.Assets.Count != 0) return Failure("MISSING_DEPENDENCY", "/document/assets", "Standalone JSON cannot supply asset content; reopen the complete .figvam container.");
            var errors = DocumentStructureValidator.Validate(doc, profile);
            if (errors.Count != 0) return new(null, errors.Take(100).Select(e => new DocumentReadDiagnostic(e.Code, "/document", e.Message, e.ObjectId, e.ReferenceId, e.Property)).ToArray());
            var nodes = doc.Nodes.ToDictionary(n => n.Id);
            var pending = new Stack<(Guid Id, int Depth)>(doc.Screens.SelectMany(s => s.ChildIds).Select(id => (id, 1)));
            while (pending.TryPop(out var frame))
            {
                if (frame.Depth > MaxTreeDepth) return Failure("DOCUMENT_DEPTH", "/document/nodes", "Node tree exceeds the depth limit.");
                foreach (var child in nodes[frame.Id].ChildIds) pending.Push((child, frame.Depth + 1));
            }
            return new(export, []);
        }
        catch (JsonException) { return Failure("INVALID_SCHEMA", "document.json", "Document data is invalid or contains unsupported types."); }
        catch (NotSupportedException) { return Failure("UNSUPPORTED_TYPE", "document.json", "Document contains an unsupported type."); }
        catch (ArgumentException) { return Failure("INVALID_DOCUMENT", "document.json", "Document values or references are invalid."); }
    }

    private static JsonNode? ParseJson(byte[] bytes)
    {
        try
        {
            _ = new UTF8Encoding(false, true).GetCharCount(bytes);
            using var parsed = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = MaxJsonDepth });
            var values = 0;
            bool Valid(JsonElement value)
            {
                if (++values > MaxJsonValues) return false;
                if (value.ValueKind == JsonValueKind.Object)
                {
                    var names = new HashSet<string>(StringComparer.Ordinal);
                    var ids = new HashSet<Guid>();
                    foreach (var property in value.EnumerateObject())
                        if (property.Name.Length > 1024 || !names.Add(property.Name) ||
                            Guid.TryParse(property.Name, out var id) && !ids.Add(id) || !Valid(property.Value)) return false;
                }
                if (value.ValueKind == JsonValueKind.Array)
                    foreach (var item in value.EnumerateArray()) if (!Valid(item)) return false;
                return value.ValueKind != JsonValueKind.String || value.GetString()!.Length <= 1024 * 1024;
            }
            if (parsed.RootElement.ValueKind != JsonValueKind.Object || !Valid(parsed.RootElement)) return null;
            return JsonNode.Parse(bytes, documentOptions: new JsonDocumentOptions { MaxDepth = MaxJsonDepth });
        }
        catch (JsonException) { return null; }
        catch (DecoderFallbackException) { return null; }
    }

    private static bool HasAssetReference(JsonNode node) => node is JsonObject obj
        ? obj.ContainsKey("assetId") || obj.Any(p => p.Value is { } value && HasAssetReference(value))
        : node is JsonArray array && array.Any(item => item is not null && HasAssetReference(item));

    private static async Task<byte[]> ReadBounded(Stream input, int limit, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var read = await input.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, limit + 1 - (int)output.Length)), cancellationToken);
            if (read == 0) return output.ToArray();
            if (output.Length + read > limit) throw new FileLimitException();
            output.Write(buffer, 0, read);
        }
    }
    private sealed class FileLimitException : Exception;
    private static DocumentReadResult Failure(string code, string path, string message) => new(null, [new(code, path, message)]);
}

