using System.Collections.Immutable;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Server.Tests;

public sealed class DocumentFileReaderTests
{
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Version1;
        public bool IsKnownKind(string kind) => kind == "frame";
        public bool CanContainChildren(string kind) => kind == "frame";
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent value) => false;
        public bool SupportsPreviewAction(PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    }
    private static readonly DocumentFileReader Reader = new(new Profile());
    private static DocumentJsonExport Export()
    {
        var screen = Guid.NewGuid(); var node = Guid.NewGuid();
        return new(1, 7, null, new(Guid.NewGuid(), [new(Guid.NewGuid(), [screen])],
            [new(screen, [node], new(800, 600))], [new(node, "frame", [])]));
    }
    private static byte[] Bytes() => DocumentJsonFormat.Serialize(Export());
    private static Task<DocumentReadResult> Json(byte[] bytes) => Reader.ReadJsonAsync(new MemoryStream(bytes));
    private static Task<DocumentReadResult> Container(byte[] bytes) => Reader.ReadContainerAsync(new MemoryStream(bytes));
    private static byte[] Zip(byte[] doc, Action<JsonObject>? manifestChange = null,
        Action<ZipArchive>? zipChange = null, bool includeDocument = true)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            var manifest = new JsonObject { ["schemaVersion"] = 1, ["files"] = new JsonArray(new JsonObject {
                ["path"] = "document.json", ["size"] = doc.Length, ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(doc)) }) };
            manifestChange?.Invoke(manifest);
            Write(zip, "manifest.json", Encoding.UTF8.GetBytes(manifest.ToJsonString()));
            if (includeDocument) Write(zip, "document.json", doc);
            zipChange?.Invoke(zip);
        }
        return output.ToArray();
    }
    private static void Write(ZipArchive zip, string path, byte[] bytes)
    { using var stream = zip.CreateEntry(path, CompressionLevel.SmallestSize).Open(); stream.Write(bytes); }
    private static void Error(DocumentReadResult result, string code)
    { Assert.Null(result.Document); Assert.Contains(result.Diagnostics, d => d.Code == code); }

    [Fact]
    public async Task ValidCurrentFormatsReturnIdenticalTypedDocumentWithoutMutation()
    {
        var export = Export(); var bytes = DocumentJsonFormat.Serialize(export);
        var json = await Json(bytes); Assert.Empty(json.Diagnostics);
        Assert.Equal(bytes, DocumentJsonFormat.Serialize(json.Document!));
        var zipped = await Container(Zip(bytes)); Assert.Empty(zipped.Diagnostics);
        Assert.Equal(bytes, DocumentJsonFormat.Serialize(zipped.Document!));
        Assert.Equal(bytes, DocumentJsonFormat.Serialize(export));
        var saved = export with { SavedVersion = new(Guid.NewGuid(), "Review", DateTimeOffset.UtcNow, "owner", export.Revision) };
        Assert.Empty((await Json(DocumentJsonFormat.Serialize(saved))).Diagnostics);
    }

    private sealed class Exporter(byte[] bytes) : IDocumentJsonExporter
    {
        public Task<DocumentJsonExportResult> ExportAsync(Guid id, long? revision, Guid? version,
            DocumentActor actor, CancellationToken cancellationToken = default) => Task.FromResult(new DocumentJsonExportResult("OK", bytes));
    }

    [Fact]
    public async Task ReadsContainerProducedByCurrentExporterAndNonSeekableInput()
    {
        var export = Export();
        export = export with { Document = export.Document with { Datasets = [new(Guid.NewGuid(), "Local", "{\"message\":\"hello\"}")] } };
        var bytes = DocumentJsonFormat.Serialize(export);
        var result = await new DocumentContainerExporter(new Exporter(bytes), new EmptyAssetStore()).ExportAsync(export.Document.Id, null, null, new("owner"));
        using var input = new NonSeekable(result.Content!);
        var read = await Reader.ReadContainerAsync(input);
        Assert.Empty(read.Diagnostics); Assert.Equal(bytes, DocumentJsonFormat.Serialize(read.Document!));
    }

    private sealed class NonSeekable(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    }

    [Theory]
    [InlineData("null", "INVALID_JSON")]
    [InlineData("[]", "INVALID_JSON")]
    [InlineData("{", "INVALID_JSON")]
    [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1}", "INVALID_JSON")]
    [InlineData("{\"schemaVersion\":2}", "UNSUPPORTED_SCHEMA_VERSION")]
    [InlineData("{\"schemaVersion\":1}", "INVALID_SCHEMA")]
    public async Task MalformedOrUnsupportedJsonIsDiagnosed(string json, string code)
        => Error(await Json(Encoding.UTF8.GetBytes(json)), code);

    [Fact]
    public async Task SchemaRejectsNullsMissingFieldsUnknownTypesAndUnexpectedProperties()
    {
        Action<JsonNode>[] changes = [
            j => j.AsObject().Remove("savedVersion"),
            j => j["document"]!["pages"] = null,
            j => j["document"]!["nodes"]![0] = null,
            j => j["document"]!["nodes"]![0]!["childIds"] = null,
            j => j["document"]!["nodes"]![0]!["properties"] = null,
            j => j["document"]!["nodes"]![0]!["properties"]!["x"] = new JsonObject { ["type"] = "unknown" },
            j => j["revision"] = -1,
            j => j["profileVersion"] = 99,
            j => j["document"]!["id"] = "bad-id"
        ];
        foreach (var change in changes)
        {
            var json = JsonNode.Parse(Bytes())!; change(json);
            Error(await Json(Encoding.UTF8.GetBytes(json.ToJsonString())), "INVALID_SCHEMA");
        }
    }

    [Fact]
    public async Task StructureReferencesCyclesKindsAndSavedMetadataAreValidated()
    {
        var original = Export(); var node = original.Document.Nodes[0];
        var changed = original with { Document = original.Document with { Nodes = [node with { Kind = "unknown" }] } };
        Error(await Json(DocumentJsonFormat.Serialize(changed)), "unknown-node-kind");
        changed = original with { Document = original.Document with { Nodes = [node with { ChildIds = [Guid.NewGuid()] }] } };
        Error(await Json(DocumentJsonFormat.Serialize(changed)), "missing-reference");
        changed = original with { Document = original.Document with { Nodes = [node with { ChildIds = [node.Id] }] } };
        Error(await Json(DocumentJsonFormat.Serialize(changed)), "cycle");
        changed = original with { SavedVersion = new(Guid.NewGuid(), null, DateTimeOffset.UtcNow, "owner", 8) };
        Error(await Json(DocumentJsonFormat.Serialize(changed)), "INVALID_SAVED_VERSION");
        changed = original with { Document = original.Document with { Nodes = [node with { Properties =
            ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("image", new NodeAssetValue(Guid.NewGuid())) }] } };
        Error(await Json(DocumentJsonFormat.Serialize(changed)), "MISSING_DEPENDENCY");
    }

    [Fact]
    public async Task EnforcesInputJsonDepthObjectCountAndTreeDepthBounds()
    {
        Error(await Json([.. Encoding.UTF8.GetBytes("{\"schemaVersion\":1,\"x\":\""), 0xff, .. Encoding.UTF8.GetBytes("\"}")]), "INVALID_JSON");
        Error(await Json(new byte[DocumentJsonFormat.MaxBytes + 1]), "FILE_TOO_LARGE");
        Error(await Container(new byte[DocumentFileReader.MaxContainerBytes + 1]), "FILE_TOO_LARGE");
        Error(await Json(Encoding.UTF8.GetBytes("{\"schemaVersion\":1,\"x\":" + new string('[', 65) + "0" + new string(']', 65) + "}")), "INVALID_JSON");
        var export = Export();
        var ids = Enumerable.Range(0, DocumentStructureLimits.MaxTreeDepth + 1).Select(_ => Guid.NewGuid()).ToArray();
        var nodes = ids.Select((id, i) => new NodeStructure(id, "frame", i + 1 < ids.Length ? [ids[i + 1]] : [])).ToArray();
        var deep = export with { Document = export.Document with { Nodes = nodes,
            Screens = [export.Document.Screens[0] with { ChildIds = [ids[0]] }] } };
        Error(await Json(DocumentJsonFormat.Serialize(deep)), "DOCUMENT_DEPTH");
        var many = export with { Document = export.Document with { Nodes = Enumerable.Range(0, DocumentFileReader.MaxNodes + 1).Select(_ => new NodeStructure(Guid.NewGuid(), "frame", [])).ToArray() } };
        Error(await Json(DocumentJsonFormat.Serialize(many)), "DOCUMENT_LIMIT");
    }

    [Fact]
    public async Task ManifestRequiresSupportedSchemaExactDependencySizeAndHash()
    {
        var doc = Bytes();
        Assert.Empty((await Container(Zip(doc, m => m["files"]![0]!["size"] = JsonNode.Parse(doc.Length + ".0")))).Diagnostics);
        Error(await Container(Zip(doc, m => m["schemaVersion"] = 2)), "UNSUPPORTED_SCHEMA_VERSION");
        Error(await Container(Zip(doc, m => m["extra"] = true)), "INVALID_SCHEMA");
        Error(await Container(Zip(doc, m => m["files"]![0]!["path"] = "../document.json")), "INVALID_SCHEMA");
        Error(await Container(Zip(doc, m => m["files"]![0]!["size"] = doc.Length + 1)), "SIZE_MISMATCH");
        Error(await Container(Zip(doc, m => m["files"]![0]!["sha256"] = new string('0', 64))), "HASH_MISMATCH");
        Error(await Container(Zip(doc, m => m["files"]![0]!["sha256"] = "invalid")), "INVALID_SCHEMA");
        Error(await Container(Zip(doc, includeDocument: false)), "MISSING_DEPENDENCY");
        Error(await Container([1, 2, 3]), "INVALID_CONTAINER");
    }

    [Theory]
    [InlineData("../document.json", "UNSAFE_ENTRY_PATH")]
    [InlineData("/document.json", "UNSAFE_ENTRY_PATH")]
    [InlineData("a\\b", "UNSAFE_ENTRY_PATH")]
    [InlineData("C:document.json", "UNSAFE_ENTRY_PATH")]
    [InlineData("./document.json", "UNSAFE_ENTRY_PATH")]
    [InlineData("tokens.json", "UNSUPPORTED_ENTRY")]
    [InlineData("MANIFEST.JSON", "DUPLICATE_ENTRY")]
    public async Task RejectsUnsafeUnexpectedAndCaseAliasedPaths(string path, string code)
        => Error(await Container(Zip(Bytes(), zipChange: zip => Write(zip, path, []), includeDocument: false)), code);

    [Fact]
    public async Task RejectsDuplicateEntriesExpansionBombsAndSymlinks()
    {
        Error(await Container(Zip(Bytes(), zipChange: zip => Write(zip, "document.json", []))), "DUPLICATE_ENTRY");
        Error(await Container(Zip(Bytes(), zipChange: zip => Write(zip, "manifest.json", []), includeDocument: false)), "DUPLICATE_ENTRY");
        Error(await Container(Zip(new byte[DocumentJsonFormat.MaxBytes + 1])), "FILE_TOO_LARGE");
        foreach (var attributes in new[] { 0xA000 << 16, 0x1000 << 16, 0x10 })
            Error(await Container(Zip(Bytes(), zipChange: zip => zip.CreateEntry("document.json").ExternalAttributes = attributes, includeDocument: false)), "UNSAFE_ENTRY_TYPE");
    }

    [Fact]
    public async Task DictionaryKeyAliasesCannotSilentlyOverwriteData()
    {
        var id = "abcdef01-2345-6789-abcd-ef0123456789";
        var aliases = "{\"schemaVersion\":1,\"map\":{\"" + id + "\":1,\"" + id.ToUpperInvariant() + "\":2}}";
        Error(await Json(Encoding.UTF8.GetBytes(aliases)), "INVALID_JSON");
        var json = JsonNode.Parse(Bytes())!;
        json["document"]!["tokens"] = new JsonArray(new JsonObject {
            ["id"] = Guid.NewGuid(), ["name"] = "Spacing", ["type"] = "Spacing",
            ["values"] = new JsonObject { ["Light"] = new JsonObject { ["expression"] = "literal", ["value"] = new JsonObject { ["type"] = "spacing", ["value"] = 8 } },
                ["light"] = new JsonObject { ["expression"] = "literal", ["value"] = new JsonObject { ["type"] = "spacing", ["value"] = 9 } } } });
        Error(await Json(Encoding.UTF8.GetBytes(json.ToJsonString())), "INVALID_SCHEMA");
    }

    [Fact]
    public async Task CancellationIsPreserved()
    {
        using var cts = new CancellationTokenSource(); cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Reader.ReadJsonAsync(new MemoryStream(Bytes()), cts.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Reader.ReadContainerAsync(new MemoryStream(Zip(Bytes())), cts.Token));
    }
}

