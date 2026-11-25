using FigVam.Application.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal : IDocumentListQuery
{
    public Task<DocumentListResponse> ListAsync(DocumentActor actor, int limit = 50, Guid? cursor = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        if (cursor == Guid.Empty) throw new ArgumentException("Cursor must be a non-empty document ID.", nameof(cursor));
        return Task.Run(() =>
        {
            var items = new List<DocumentListItem>();
            if (string.IsNullOrWhiteSpace(actor.Id)) return new DocumentListResponse(items, null);
            var after = cursor?.ToString("N");
            var paths = Directory.EnumerateFiles(directory, "*.sqlite")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => name is not null && Guid.TryParseExact(name, "N", out var id) && id != Guid.Empty &&
                    string.Equals(name, id.ToString("N"), StringComparison.Ordinal) &&
                    (after is null || string.CompareOrdinal(name, after) > 0))
                .Order(StringComparer.Ordinal);
            foreach (var name in paths)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var id = Guid.ParseExact(name!, "N");
                var item = ReadCatalogItem(id, actor.Id);
                if (item is null) continue;
                if (items.Count == limit) return new DocumentListResponse(items, items[^1].DocumentId);
                items.Add(item);
            }
            return new DocumentListResponse(items, null);
        }, cancellationToken);
    }

    private DocumentListItem? ReadCatalogItem(Guid id, string actorId)
    {
        DocumentRole? role = null;
        long? revision = null;
        try
        {
            using var connection = Open(id);
            using (var transaction = connection.BeginTransaction(deferred: true))
            {
                if (IsDeleted(connection, transaction)) return null;
                role = ReadRole(connection, transaction, actorId);
                if (role is null) return null;
                try
                {
                    if (ReadMetadata(connection, transaction) is { } existing)
                        return CatalogItem(id, role.Value, existing);
                }
                catch (Exception error) when (IsCatalogReadError(error))
                {
                    revision = ReadCatalogRevision(connection, transaction);
                    throw;
                }
            }
            // Recheck authorization and tombstone under the writer lock before lazy backfill.
            role = null;
            using var migration = connection.BeginTransaction(deferred: false);
            if (IsDeleted(connection, migration)) return null;
            role = ReadRole(connection, migration, actorId);
            if (role is null) return null;
            revision = ReadCatalogRevision(connection, migration);
            var metadata = ReadMetadata(connection, migration);
            if (metadata is null)
            {
                metadata = ReadLegacyMetadata(connection, migration);
                if (metadata is null) return null;
                ValidateCatalogIdentity(id, metadata);
                WriteMetadata(connection, migration, metadata);
            }
            migration.Commit();
            return CatalogItem(id, role.Value, metadata);
        }
        catch (Exception error) when (IsCatalogReadError(error))
        {
            System.Diagnostics.Trace.TraceWarning("Could not read document catalog metadata for {0}: {1}", id, error.GetType().Name);
            // Never expose a file whose membership and deletion status could not be established.
            return role is null ? null : UnreadableCatalogItem(id, role.Value, revision);
        }
    }

    private static bool IsCatalogReadError(Exception error) =>
        error is FormatException or InvalidCastException or OverflowException or InvalidDataException ||
        error is SqliteException { SqliteErrorCode: 1 or 10 or 11 or 14 or 26 };

    private DocumentListItem UnreadableCatalogItem(Guid id, DocumentRole role, long? revision)
        => new(id, id.ToString(), role.ToString())
        {
            CurrentProfileVersion = profile.Identity.Version, Revision = revision, CompatibilityIssue = "METADATA_UNAVAILABLE"
        };
}
