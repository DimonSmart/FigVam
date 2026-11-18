using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;

namespace FigVam.Server.Tests;

public sealed class DocumentJsonExportTests
{
    [Theory]
    [InlineData("unknown", 1, "PROFILE_UNAVAILABLE")]
    [InlineData("figvam.portable-ui", 7, "UNSUPPORTED_PROFILE_VERSION")]
    public async Task ExportRejectsUnavailableProfileEvenWhenStateReaderReturnsIt(string id, int version, string code)
    {
        var document = RichDocument() with { Profile = new(id, version) };
        var reader = new Reader(document);
        var exporter = new DocumentJsonExporter(new Authorization(), reader, reader, new UnverifiedNodeProfile());
        var result = await exporter.ExportAsync(document.Id, 7, null, new("owner"));
        Assert.Equal(code, result.Code);
        Assert.Null(result.Content);
    }

    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private sealed class Reader(DocumentStructure document, string code = "OK") : IDocumentStateReader, IDocumentVersionStore
    {
        public int Reads { get; private set; }
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default)
        { Reads++; return Task.FromResult(new DocumentStateReadResult(code, code == "OK" ? new(document, 7) : null)); }
        public Task<DocumentVersionResult> ReadVersionAsync(Guid id, Guid version, CancellationToken ct = default)
            => throw new InvalidOperationException("Unexpected saved-version read.");
        public Task<DocumentVersionListResult> ListVersionsAsync(Guid id, int limit, long? before, CancellationToken ct = default)
            => throw new InvalidOperationException();
    }

    [Fact]
    public async Task CompleteDurableModelIsSchemaValidAndRetainsAllFieldsAndOrderedLists()
    {
        var doc = RichDocument(); var reader = new Reader(doc);
        var result = await new DocumentJsonExporter(new Authorization(), reader, reader, new UnverifiedNodeProfile()).ExportAsync(doc.Id, 7, null, new("editor"));
        Assert.Equal("OK", result.Code);
        var node = JsonNode.Parse(result.Content!)!;
        Assert.True(JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.CreateDocumentFormat()), new BuildOptions { SchemaRegistry = new SchemaRegistry() }).EvaluateNode(node).IsValid);
        var restored = JsonSerializer.Deserialize<DocumentJsonExport>(result.Content!, DocumentJsonFormat.CreateOptions())!;
        Assert.Equal(result.Content, DocumentJsonFormat.Serialize(restored));
        Assert.Equal(DocumentJsonFormat.Serialize(new(1, 7, null, doc)), DocumentJsonFormat.Serialize(restored));
        Assert.Equal(doc.Datasets[0].FixtureJson, restored.Document.Datasets[0].FixtureJson);
        Assert.Equal("server-link", restored.Document.Datasets[0].ConnectorId);
        Assert.Equal(doc.Pages.Select(p => p.Id), restored.Document.Pages.Select(p => p.Id));
        Assert.IsType<Navigate>(restored.Document.Scenarios[0].Actions[0]);
        Assert.IsType<ResetPreview>(restored.Document.Scenarios[0].Actions[1]);
        Assert.NotNull(restored.Document.Nodes[0].Repeater);
        Assert.Null(restored.SavedVersion);
        node["schemaVersion"] = 2;
        var schema = JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.CreateDocumentFormat()), new BuildOptions { SchemaRegistry = new SchemaRegistry() });
        Assert.False(schema.EvaluateNode(node).IsValid);
        node["schemaVersion"] = 1; node.AsObject().Remove("savedVersion");
        Assert.False(schema.EvaluateNode(node).IsValid);
    }

    [Fact]
    public void DictionaryInsertionOrderCannotChangeBytesAndUnknownValuesAreRejectedBySchema()
    {
        var doc = RichDocument(); var instance = doc.ComponentInstances[0];
        var changed = doc with { ComponentInstances = [instance with {
            ParameterOverrides = instance.ParameterOverrides.Reverse().ToDictionary(p => p.Key, p => p.Value)
        }] };
        var first = DocumentJsonFormat.Serialize(new(1, 7, null, doc));
        Assert.Equal(first, DocumentJsonFormat.Serialize(new(1, 7, null, changed)));
        Assert.NotEqual((byte)'\n', first[^1]);
        var node = JsonNode.Parse(first)!;
        node["document"]!["nodes"]![0]!["properties"]!["text"]!["type"] = "unrecognized";
        Assert.False(JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.CreateDocumentFormat()), new BuildOptions { SchemaRegistry = new SchemaRegistry() }).EvaluateNode(node).IsValid);
    }

    [Fact]
    public async Task PermissionAndInvalidSelectorsDoNotReadDataAndFailuresNeverReturnPartialFiles()
    {
        var doc = RichDocument(); var reader = new Reader(doc); var exporter = new DocumentJsonExporter(new Authorization(), reader, reader, new UnverifiedNodeProfile());
        foreach (var actor in new[] { "viewer", "outsider", "" })
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(doc.Id, null, null, new(actor))).Code);
        Assert.Equal("INVALID_QUERY", (await exporter.ExportAsync(doc.Id, 7, Guid.NewGuid(), new("owner"))).Code);
        Assert.Equal("INVALID_REVISION", (await exporter.ExportAsync(doc.Id, -1, null, new("owner"))).Code);
        Assert.Equal("INVALID_ID", (await exporter.ExportAsync(doc.Id, null, Guid.Empty, new("owner"))).Code);
        Assert.Equal(0, reader.Reads);
        foreach (var code in new[] { "REVISION_UNAVAILABLE", "DOCUMENT_NOT_FOUND" })
        {
            var failed = new Reader(doc, code);
            var failure = await new DocumentJsonExporter(new Authorization(), failed, failed, new UnverifiedNodeProfile()).ExportAsync(doc.Id, 7, null, new("owner"));
            Assert.Equal(code, failure.Code); Assert.Null(failure.Content);
        }
        var unavailable = doc with { Nodes = [doc.Nodes[0] with { Properties = doc.Nodes[0].Properties.Add("image", new NodeAssetValue(Guid.NewGuid())) }] };
        var missing = new Reader(unavailable);
        var result = await new DocumentJsonExporter(new Authorization(), missing, missing, new UnverifiedNodeProfile()).ExportAsync(doc.Id, null, null, new("owner"));
        Assert.Equal("EXPORT_DEPENDENCY_UNAVAILABLE", result.Code); Assert.Null(result.Content);
        var unsupported = new Reader(doc with { Nodes = [doc.Nodes[0] with { Properties = doc.Nodes[0].Properties.Add("new", new UnknownValue()) }] });
        result = await new DocumentJsonExporter(new Authorization(), unsupported, unsupported, new UnverifiedNodeProfile()).ExportAsync(doc.Id, null, null, new("owner"));
        Assert.Equal("EXPORT_UNSUPPORTED_DATA", result.Code); Assert.Null(result.Content);
        var oversized = new Reader(doc with { Pages = [new(Guid.NewGuid(), []) { Name = new string('x', DocumentJsonFormat.MaxBytes) }] });
        result = await new DocumentJsonExporter(new Authorization(), oversized, oversized, new UnverifiedNodeProfile()).ExportAsync(doc.Id, null, null, new("owner"));
        Assert.Equal("EXPORT_TOO_LARGE", result.Code); Assert.Null(result.Content);
    }
    private sealed record UnknownValue : NodePropertyValue;

    [Fact]
    public async Task RevisionAndSavedVersionRemainStableAcrossLaterEditsAndReopen()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-json-export-" + Guid.NewGuid());
        try
        {
            var id = Guid.NewGuid(); var owner = new DocumentActor("owner"); var profile = new UnverifiedNodeProfile();
            var journal = new SqliteDocumentJournal(directory, profile);
            Assert.True((await journal.CreateAsync(new(id), owner)).Accepted);
            var handler = new DocumentCommandHandler(journal, journal, profile);
            Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), owner)).Accepted);
            var exporter = new DocumentJsonExporter(journal, journal, journal, new FigVam.Server.Documents.UnverifiedNodeProfile());
            var before = await exporter.ExportAsync(id, 1, null, owner);
            var save = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Review"), owner);
            Assert.True(save.Accepted);
            var saved = await exporter.ExportAsync(id, null, save.VersionId, owner);
            var json = JsonSerializer.Deserialize<DocumentJsonExport>(saved.Content!, DocumentJsonFormat.CreateOptions())!;
            Assert.Equal(save.VersionId, json.SavedVersion!.Id); Assert.Equal(save.Revision, json.Revision);
            Assert.Equal("Review", json.SavedVersion.Name); Assert.Equal("owner", json.SavedVersion.AuthorId);
            Assert.Equal(save.Timestamp, json.SavedVersion.Timestamp);
            Assert.True(JsonSchema.Build(JsonSerializer.SerializeToElement(DocumentSchemas.CreateDocumentFormat()), new BuildOptions { SchemaRegistry = new SchemaRegistry() }).EvaluateNode(JsonNode.Parse(saved.Content!)!).IsValid);
            Assert.True((await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), owner)).Accepted);
            var reopened = new SqliteDocumentJournal(directory, profile);
            exporter = new(reopened, reopened, reopened, profile);
            Assert.Equal(before.Content, (await exporter.ExportAsync(id, 1, null, owner)).Content);
            Assert.Equal(saved.Content, (await exporter.ExportAsync(id, null, save.VersionId, owner)).Content);
            Assert.Equal(2, JsonSerializer.Deserialize<DocumentJsonExport>((await exporter.ExportAsync(id, null, null, owner)).Content!, DocumentJsonFormat.CreateOptions())!.Document.Pages.Count);
            Assert.Equal("INVALID_REVISION", (await exporter.ExportAsync(id, 999, null, owner)).Code);
            Assert.Equal("VERSION_NOT_FOUND", (await exporter.ExportAsync(id, null, Guid.NewGuid(), owner)).Code);
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(Guid.NewGuid(), null, save.VersionId, owner)).Code);
            await journal.SetMemberAsync(id, "editor", DocumentRole.Editor, owner);
            Assert.Equal("OK", (await exporter.ExportAsync(id, null, save.VersionId, new("editor"))).Code);
            await journal.RemoveMemberAsync(id, "editor", owner);
            Assert.Equal("FORBIDDEN", (await exporter.ExportAsync(id, null, save.VersionId, new("editor"))).Code);
        }
        finally { Directory.Delete(directory, true); }
    }

    private static DocumentStructure RichDocument()
    {
        var id = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid(); var definition = Guid.NewGuid();
        var parameter = Guid.NewGuid(); var secondParameter = Guid.NewGuid(); var dataset = Guid.NewGuid(); var token = Guid.NewGuid(); var slot = Guid.NewGuid();
        return new(id, [new(Guid.NewGuid(), [screen]) { Name = "Page Ω" }, new(Guid.NewGuid(), []) { Name = "Second" }],
            [new(screen, [node], new(1024, 768)) { Variants = [new(Guid.NewGuid(), "Changed", [new(node, "text", new NodeStringValue("Variant"))])] }],
            [new(node, "test", []) { Name = "A", SemanticKey = "button", Properties = ImmutableSortedDictionary<string, NodePropertyValue>.Empty.Add("text", new NodeStringValue("Hello")),
                Repeater = new(dataset, new([new DataProperty("rows")], DataOperation.Value, DataExpectedType.Array), Guid.NewGuid(), Guid.NewGuid(),
                    [new(node, "text", new([new DataProperty("label")], DataOperation.Value, DataExpectedType.String))]),
                DataBindings = ImmutableSortedDictionary<string, NodeDataBinding>.Empty.Add("text", new(dataset, new([], DataOperation.Value, DataExpectedType.String))) }])
        {
            Datasets = [new(dataset, "Fixture", "{ \"name\": \"local\", \"rows\": [] }", "server-link")],
            Tokens = [new(token, "Text", TokenType.Typography, new Dictionary<TokenTheme, TokenExpression> {
                [TokenTheme.Dark] = new LiteralTokenValue(new TypographyValue("Arial", 12, 400, 1.2)), [TokenTheme.Light] = new TokenAlias(token) })],
            ComponentDefinitions = [new(definition, "Button", "Description", node,
                [new(parameter, "Text", ComponentParameterType.Text, new ComponentText("default")), new(secondParameter, "Flag", ComponentParameterType.Bool, new ComponentBool(true))],
                [new(slot, "Content", node)], [new(Guid.NewGuid(), "Default", ComponentVariantKind.Default, null, new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("variant") })]) {
                    Bindings = [new(parameter, node, "text")] }],
            ComponentInstances = [new(node, definition, null, new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("instance"), [secondParameter] = new ComponentBool(false) }, new Dictionary<Guid, IReadOnlyList<Guid>> { [slot] = [] })],
            Scenarios = [new(Guid.NewGuid(), screen, node, PreviewEvent.Click, [new Navigate(screen), new ResetPreview()])]
        };
    }
}
