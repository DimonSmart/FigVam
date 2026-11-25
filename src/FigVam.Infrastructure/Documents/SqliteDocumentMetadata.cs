using System.Globalization;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal
{
    private const int StorageSchemaVersion = 1;
    private sealed record CatalogMetadata(int Schema, string Name, string ProfileId, int ProfileVersion,
        long Revision, DateTimeOffset? CreatedAt, DateTimeOffset? UpdatedAt);

    private static void WriteMetadata(SqliteConnection connection, SqliteTransaction transaction,
        DocumentStructure document, long revision, DateTimeOffset? created, DateTimeOffset? updated)
        => WriteMetadata(connection, transaction, new(StorageSchemaVersion, document.Name, document.Profile.Id,
            document.Profile.Version, revision, created, updated));

    private static void WriteMetadata(SqliteConnection connection, SqliteTransaction transaction, CatalogMetadata metadata)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO document_metadata(singleton,schema_version,name,profile_id,profile_version,revision,created_utc,updated_utc)
            VALUES(1,$schema,$name,$profile,$version,$revision,$created,$updated)
            ON CONFLICT(singleton) DO UPDATE SET schema_version=excluded.schema_version,name=excluded.name,
                profile_id=excluded.profile_id,profile_version=excluded.profile_version,revision=excluded.revision,
                updated_utc=excluded.updated_utc
            """;
        command.Parameters.AddWithValue("$schema", metadata.Schema);
        command.Parameters.AddWithValue("$name", metadata.Name);
        command.Parameters.AddWithValue("$profile", metadata.ProfileId);
        command.Parameters.AddWithValue("$version", metadata.ProfileVersion);
        command.Parameters.AddWithValue("$revision", metadata.Revision);
        command.Parameters.AddWithValue("$created", (object?)metadata.CreatedAt?.ToString("O") ?? DBNull.Value);
        command.Parameters.AddWithValue("$updated", (object?)metadata.UpdatedAt?.ToString("O") ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    private static DateTimeOffset? ReadDate(SqliteDataReader reader, int column)
        => reader.IsDBNull(column) ? null : DateTimeOffset.Parse(reader.GetString(column), CultureInfo.InvariantCulture);

    private static CatalogMetadata? ReadMetadata(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT schema_version,name,profile_id,profile_version,revision,created_utc,updated_utc FROM document_metadata WHERE singleton=1";
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(reader.GetInt32(0), reader.GetString(1), reader.GetString(2),
            reader.GetInt32(3), reader.GetInt64(4), ReadDate(reader, 5), ReadDate(reader, 6)) : null;
    }

    // A one-time projection for pre-catalog databases. SQLite extracts scalar JSON fields only;
    // no DocumentStructure deserialization, validation, asset access or domain event replay.
    // The last name change may be a rename, restore or undo/redo after the last snapshot.
    private static CatalogMetadata? ReadLegacyMetadata(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            WITH latest AS (SELECT revision,document FROM snapshots ORDER BY revision DESC LIMIT 1),
            names AS (
                SELECT revision,json_extract(document,'$.Name') AS name FROM latest
                UNION ALL SELECT p.revision,json_extract(p.payload,'$.Name')
                    FROM payload_events p JOIN events e ON e.revision=p.revision
                    WHERE e.type='RENAME_DOCUMENT' AND p.revision>(SELECT revision FROM latest)
                UNION ALL SELECT revision,json_extract(document,'$.Name')
                    FROM restore_events WHERE revision>(SELECT revision FROM latest)
                UNION ALL SELECT revision,json_extract(payload,'$.Patch.Name.After')
                    FROM compensation_events WHERE revision>(SELECT revision FROM latest)
            )
            SELECT (SELECT name FROM names WHERE name IS NOT NULL ORDER BY revision DESC LIMIT 1),
                json_extract(document,'$.Profile.Id'),json_extract(document,'$.Profile.Version'),
                MAX(revision,COALESCE((SELECT MAX(revision) FROM events),0)),
                (SELECT timestamp FROM events ORDER BY revision DESC LIMIT 1)
            FROM latest
            """;
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        // Unknown legacy profile is not silently substituted with the current one.
        return new(StorageSchemaVersion, reader.IsDBNull(0) ? "Document" : reader.GetString(0),
            reader.IsDBNull(1) ? "" : reader.GetString(1), reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
            reader.GetInt64(3), null, ReadDate(reader, 4));
    }

    private DocumentListItem CatalogItem(Guid id, DocumentRole role, CatalogMetadata metadata)
        => new(id, metadata.Name, role.ToString())
        {
            StorageSchemaVersion = metadata.Schema, ProfileId = metadata.ProfileId,
            ProfileVersion = metadata.ProfileVersion, CurrentProfileVersion = profile.Identity.Version,
            Revision = metadata.Revision, CreatedAt = metadata.CreatedAt, UpdatedAt = metadata.UpdatedAt,
            CompatibilityIssue = metadata.Schema != StorageSchemaVersion ? "UNSUPPORTED_STORAGE_SCHEMA" :
                PortableUiProfileResolver.Validate(new(metadata.ProfileId, metadata.ProfileVersion), profile)?.Code
        };

    private static long? ReadCatalogRevision(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT MAX((SELECT MAX(revision) FROM snapshots),COALESCE((SELECT MAX(revision) FROM events),0))
            """;
        return command.ExecuteScalar() is long revision ? revision : null;
    }
}
