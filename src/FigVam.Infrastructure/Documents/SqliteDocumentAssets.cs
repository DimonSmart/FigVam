using System.Security.Cryptography;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal
{
    private static void StoreAssetContent(SqliteConnection connection, SqliteTransaction transaction, DocumentChange change)
    {
        if (change.Event is not AssetAdded added)
        {
            if (change.AssetContent is not null) throw new InvalidOperationException("Unexpected asset content.");
            return;
        }
        var content = change.AssetContent ?? throw new InvalidOperationException("Asset upload requires content.");
        if (content.Asset != added.Asset || SafeRasterImage.Inspect(added.Asset.Id, added.Asset.ContentType, content.Content) != added.Asset ||
            change.State?.Document.Assets.Count(a => a == added.Asset) != 1)
            throw new InvalidOperationException("Asset content does not match its manifest.");
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO asset_content(sha256,content) VALUES($hash,$content) ON CONFLICT(sha256) DO NOTHING";
        command.Parameters.AddWithValue("$hash", added.Asset.Sha256);
        command.Parameters.AddWithValue("$content", content.Content);
        command.ExecuteNonQuery();
    }

    private static byte[]? ReadAssetContent(SqliteConnection connection, SqliteTransaction? transaction, DocumentAsset asset)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT content FROM asset_content WHERE sha256=$hash";
        command.Parameters.AddWithValue("$hash", asset.Sha256);
        if (command.ExecuteScalar() is not byte[] content || content.Length != asset.ByteLength ||
            Convert.ToHexStringLower(SHA256.HashData(content)) != asset.Sha256) return null;
        return content;
    }

    private static void ValidateStoredAssets(SqliteConnection connection, SqliteTransaction? transaction, DocumentStructure document)
    {
        foreach (var asset in document.Assets)
            if (ReadAssetContent(connection, transaction, asset) is null)
                throw new InvalidDataException("Asset content integrity check failed.");
    }

    public Task<byte[]?> ReadAssetContentAsync(Guid documentId, DocumentAsset asset, CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            return IsDeleted(connection, transaction) ? null : ReadAssetContent(connection, transaction, asset);
        }, cancellationToken);
}
