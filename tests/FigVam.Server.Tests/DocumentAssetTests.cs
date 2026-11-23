using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentAssetTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-assets-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), other = Guid.NewGuid(), asset = Guid.NewGuid();
    private readonly DocumentActor owner = new("owner"), viewer = new("viewer"), editor = new("editor");
    private readonly Profile profile = new();
    private SqliteDocumentJournal Journal() => new(directory, profile);
    private DocumentCommandHandler Handler() => new(Journal(), Journal(), profile);
    private DocumentAssets Assets() => new(Journal(), Journal(), Journal(), Journal());
    private UploadDocumentAssetCommand Upload(Guid? command = null) => new(doc, command ?? Guid.NewGuid(), asset, "image/png", Png());
    private async Task Initialize()
    {
        Assert.Equal("ACCEPTED", (await Journal().CreateAsync(new(doc), owner)).Code);
        Assert.Equal("ACCEPTED", (await Journal().CreateAsync(new(other), new("other-owner"))).Code);
        await Journal().SetMemberAsync(doc, viewer.Id, DocumentRole.Viewer, owner);
        await Journal().SetMemberAsync(doc, editor.Id, DocumentRole.Editor, owner);
    }

    [Fact]
    public async Task UploadRecoveryVersionsRevisionsEventsAndSafeHistoryShareOneStream()
    {
        await Initialize(); var command = Upload();
        var accepted = await Handler().HandleAsync(command, owner);
        Assert.True(accepted.Accepted); Assert.Equal(1, accepted.Revision); Assert.Equal(new[] { asset }, accepted.AffectedIds);
        Assert.Equal(accepted, await Handler().HandleAsync(command with { AssetId = Guid.Empty, Content = [1], ContentType = "text/html" }, owner));
        var manifest = (await Assets().ListAsync(doc, viewer)).Response!; var item = Assert.Single(manifest.Assets);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Png())), item.Sha256);
        Assert.Equal(2, item.Width); Assert.Equal(1, item.Height); Assert.Equal(Png().Length, item.ByteLength);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, viewer)).Content!.Content);
        Assert.Equal("ASSET_NOT_FOUND", (await Assets().ReadAsync(doc, asset, viewer, revision: 0)).Code);
        var evt = Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!);
        Assert.Equal("UPLOAD_ASSET", evt.Type); Assert.Equal(command.CommandId, evt.CommandId); Assert.IsType<AssetAdded>(evt.Payload);
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid(), "With image"), owner);
        Assert.True(saved.Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Empty((await Assets().ListAsync(doc, viewer)).Response!.Assets);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, viewer, versionId: saved.VersionId)).Content!.Content);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, viewer, revision: 1)).Content!.Content);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        for (var i = 0; i < 33; i++) Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), editor)).Accepted);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, viewer)).Content!.Content);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), saved.VersionId!.Value), owner)).Accepted);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, viewer)).Content!.Content);
        Assert.Equal("INVALID_QUERY", (await Assets().ListAsync(doc, owner, 1, saved.VersionId)).Code);
    }

    [Fact]
    public async Task AuthorizationIsolationAndIdCollisionsDoNotChangeRevision()
    {
        await Initialize();
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Upload(), viewer)).Code);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Upload(), new("other-owner"))).Code);
        Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.True((await Handler().HandleAsync(Upload(), editor)).Accepted);
        Assert.Equal("FORBIDDEN", (await Assets().ReadAsync(doc, asset, new("other-owner"))).Code);
        Assert.Equal("ASSET_NOT_FOUND", (await Assets().ReadAsync(other, asset, new("other-owner"))).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(Upload(), owner)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(Upload() with { AssetId = doc }, owner)).Code);
        Assert.Equal("DUPLICATE_ID", (await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), asset), owner)).Code);
        Assert.Equal(1, (await Journal().ReadAsync(doc))!.Revision);
    }

    [Fact]
    public async Task ReferencesInNodesComponentValuesAndScreenVariantsUseSnapshotManifest()
    {
        await Initialize(); Assert.True((await Handler().HandleAsync(Upload(), owner)).Accepted);
        var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var node = Guid.NewGuid(); var component = Guid.NewGuid(); var parameter = Guid.NewGuid(); var variant = Guid.NewGuid();
        Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), page), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddScreenCommand(doc, Guid.NewGuid(), page, screen, new(100,100)), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddNodeCommand(doc, Guid.NewGuid(), screen, node, "image"), editor)).Accepted);
        Assert.False((await Handler().HandleAsync(new SetNodePropertyCommand(doc, Guid.NewGuid(), node, "source", new NodeAssetValue(Guid.NewGuid())), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new SetNodePropertyCommand(doc, Guid.NewGuid(), node, "source", new NodeAssetValue(asset)), editor)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Code);
        Assert.True((await Handler().HandleAsync(new AddComponentDefinitionCommand(doc, Guid.NewGuid(), component, "Image", "", node), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddComponentParameterCommand(doc, Guid.NewGuid(), component, new(parameter, "source", ComponentParameterType.Asset, new ComponentAsset(asset)), node, "source"), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new AddScreenVariantCommand(doc, Guid.NewGuid(), screen, variant, "Alternate"), editor)).Accepted);
        Assert.True((await Handler().HandleAsync(new SetScreenVariantOverrideCommand(doc, Guid.NewGuid(), screen, variant, node, "source", new NodeAssetValue(asset)), editor)).Accepted);
        var current = (await Journal().ReadAsync(doc))!;
        Assert.Empty(DocumentStructureValidator.Validate(current.Document, profile));
        Assert.Contains(DocumentStructureValidator.Validate(current.Document with { Assets = [] }, profile), e => e.Code == "missing-reference");
        Assert.Empty((await Journal().ReadAsync(doc, 0)).State!.Document.Assets);
        Assert.Equal(Png(), (await Assets().ReadAsync(doc, asset, owner)).Content!.Content);
    }

    [Fact]
    public async Task InvalidUploadsLeaveNoManifestContentOrEventsAndTamperingIsDetected()
    {
        await Initialize();
        foreach (var bytes in InvalidPngs()) Assert.Equal("INVALID_ASSET", (await Handler().HandleAsync(Upload() with { Content = bytes }, owner)).Code);
        Assert.Equal("INVALID_ASSET", (await Handler().HandleAsync(Upload() with { ContentType = "image/jpeg" }, owner)).Code);
        Assert.Equal("ASSET_TOO_LARGE", (await Handler().HandleAsync(Upload() with { Content = new byte[DocumentAssetValidator.MaxAssetBytes + 1] }, owner)).Code);
        Assert.Empty((await Journal().ReadEventsAsync(doc, 0)).Events!); Assert.Empty((await Assets().ListAsync(doc, owner)).Response!.Assets);
        Assert.True((await Handler().HandleAsync(Upload(), owner)).Accepted);
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{doc:N}.sqlite")};Pooling=False"))
        {
            connection.Open(); using var corrupt = connection.CreateCommand(); corrupt.CommandText = "UPDATE asset_content SET content=X'00'"; corrupt.ExecuteNonQuery();
        }
        await Assert.ThrowsAsync<InvalidDataException>(() => Journal().ReadAsync(doc));
        Assert.NotNull(await Journal().ReadAsync(other));
    }

    public static IEnumerable<byte[]> InvalidPngs()
    {
        yield return Encoding.UTF8.GetBytes("<svg><script>alert(1)</script><image href='https://example.com/x'/></svg>");
        yield return Png()[..^1]; yield return [.. Png(), .. Encoding.UTF8.GetBytes("<script>evil</script>")];
        var crc = Png(); crc[29] ^= 1; yield return crc;
        yield return Png(filter: 5); yield return Png(width: 4097); yield return Png(width: 4096, height: 4096);
        yield return Png(raw: [0, 1]); yield return Png(raw: [0, 255,0,0,0,255,0, 1]);
        yield return Png(extra: Chunk("tEXt", Encoding.UTF8.GetBytes("link\0https://example.com")));
        yield return Png(extra: Chunk("acTL", new byte[8]));
        using (var compressed = new MemoryStream())
        {
            using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, true)) zlib.Write(new byte[] { 0,255,0,0,0,255,0 });
            var bytes = compressed.ToArray();
            yield return Png(compressed: [.. bytes, 0,1,2,3, .. bytes[^4..]]);
        }
        var badZlib = new byte[] { 0x78, 0x9c, 0, 1, 2, 3, 4, 5 }; yield return Png(compressed: badZlib);
    }
    public static byte[] Png(int width = 2, int height = 1, byte filter = 0, byte[]? raw = null, byte[]? extra = null, byte[]? compressed = null)
    {
        var header = new byte[13]; BinaryPrimitives.WriteInt32BigEndian(header, width); BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height); header[8] = 8; header[9] = 2;
        using var data = new MemoryStream();
        using (var zlib = new ZLibStream(data, CompressionLevel.SmallestSize, true)) zlib.Write(raw ?? [filter, 255, 0, 0, 0, 255, 0]);
        return [137,80,78,71,13,10,26,10, .. Chunk("IHDR", header), .. extra ?? [], .. Chunk("IDAT", compressed ?? data.ToArray()), .. Chunk("IEND", [])];
    }
    private static byte[] Chunk(string type, byte[] data)
    {
        var result = new byte[data.Length + 12]; BinaryPrimitives.WriteInt32BigEndian(result, data.Length); Encoding.ASCII.GetBytes(type).CopyTo(result, 4); data.CopyTo(result, 8);
        uint crc = 0xffffffff;
        foreach (var b in result.AsSpan(4, data.Length + 4)) { crc ^= b; for (var i=0;i<8;i++) crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u); }
        BinaryPrimitives.WriteUInt32BigEndian(result.AsSpan(data.Length + 8), ~crc); return result;
    }
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "image";
        public bool CanContainChildren(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "source" ? new(NodePropertyType.Asset) : null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
