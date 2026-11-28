using System.Collections.Immutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

// All server instances must use this same local durable directory. SQLite's file locks,
// rather than process-local locks or caches, establish the authoritative document stream.
public sealed partial class SqliteDocumentJournal
    : IDocumentCommandResultReader, IDocumentCommandJournal, IDocumentBatchJournal, IDocumentEventJournal, IDocumentVersionStore, IDocumentCommandHistoryStore, IDocumentStateReader, IDocumentAssetStore
{
    private const string EventProjection = """
        SELECT e.revision,e.type,e.subject_id,s.screen_id,n.node_id,n.kind,m.parent_id,m.position,
            e.command_id,e.actor_id,r.document,c.payload,p.property,p.value,d.payload,
            COALESCE(json_extract(command_result.result, '$.Source'), 'UI')
        FROM events e
        LEFT JOIN screen_events s ON s.revision=e.revision
        LEFT JOIN node_events n ON n.revision=e.revision
        LEFT JOIN move_events m ON m.revision=e.revision
        LEFT JOIN restore_events r ON r.revision=e.revision
        LEFT JOIN compensation_events c ON c.revision=e.revision
        LEFT JOIN property_events p ON p.revision=e.revision
        LEFT JOIN payload_events d ON d.revision=e.revision
        LEFT JOIN results command_result ON command_result.command_id=e.command_id
        """;
    private const int SnapshotInterval = 32;
    private const int MaxReconnectEvents = 100;
    private const int MaxReconnectPayloadBytes = 1024 * 1024;
    private readonly string directory;
    private readonly INodeProfile profile;

    public SqliteDocumentJournal(string directory, INodeProfile profile)
    {
        this.directory = Path.GetFullPath(directory);
        this.profile = profile;
        Directory.CreateDirectory(this.directory);
    }

    private SqliteConnection Open(Guid id)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(directory, $"{id:N}.sqlite"), Pooling = false,
            DefaultTimeout = 30
        }.ToString());
        try
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS document_deletion(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS asset_content(sha256 TEXT PRIMARY KEY, content BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS members(actor_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('Owner','Editor','Viewer')));
                CREATE TABLE IF NOT EXISTS command_history(command_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, result TEXT NOT NULL,
                    type TEXT NOT NULL, patch TEXT, status TEXT NOT NULL, history_order INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS command_history_groups(command_id TEXT PRIMARY KEY, group_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS compensation_events(revision INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS user_versions(version_id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, payload TEXT NOT NULL, sha256 BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS snapshots(revision INTEGER PRIMARY KEY, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS document_metadata(
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL,
                    document_id TEXT NOT NULL, name TEXT NOT NULL, profile_id TEXT NOT NULL, profile_version INTEGER NOT NULL,
                    revision INTEGER NOT NULL, created_utc TEXT, updated_utc TEXT);
                CREATE TABLE IF NOT EXISTS results(command_id TEXT PRIMARY KEY, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(revision INTEGER PRIMARY KEY, command_id TEXT NOT NULL UNIQUE,
                    actor_id TEXT NOT NULL, timestamp TEXT NOT NULL, type TEXT NOT NULL, subject_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS screen_events(revision INTEGER PRIMARY KEY, screen_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS node_events(revision INTEGER PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS restore_events(revision INTEGER PRIMARY KEY, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS payload_events(revision INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS property_events(revision INTEGER PRIMARY KEY, property TEXT NOT NULL, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS move_events(revision INTEGER PRIMARY KEY, parent_id TEXT NOT NULL, position INTEGER NOT NULL);
                """;
            command.ExecuteNonQuery();
            return connection;
        }
        catch { connection.Dispose(); throw; }
    }

    // Storage-level seed for validated imports and tests; does not grant application access.
    public Task InitializeAsync(DocumentStructure document, CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            Validate(document);
            using var connection = Open(document.Id);
            using var transaction = connection.BeginTransaction(deferred: false);
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO snapshots(revision,document) VALUES(0,$document)";
            command.Parameters.AddWithValue("$document", JsonSerializer.Serialize(document));
            command.ExecuteNonQuery();
            var now = DateTimeOffset.UtcNow;
            WriteMetadata(connection, transaction, document, 0, now, now);
            transaction.Commit();
        }, cancellationToken);

    public Task<DocumentState?> ReadAsync(Guid documentId, CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            return Recover(connection, transaction, documentId);
        }, cancellationToken);

    public Task<DocumentStateReadResult> ReadAsync(Guid documentId, long? revision, CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            if (revision < 0) return new DocumentStateReadResult("INVALID_REVISION");
            using var connection = Open(documentId);
            // Revision bounds, snapshot selection and replay see the same committed document stream.
            using var transaction = connection.BeginTransaction(deferred: true);
            if (IsDeleted(connection, transaction)) return new DocumentStateReadResult("DOCUMENT_NOT_FOUND");
            if (revision is null)
            {
                var current = Recover(connection, transaction, documentId);
                return current is null ? new DocumentStateReadResult("DOCUMENT_NOT_FOUND") : new DocumentStateReadResult("OK", current);
            }
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT MAX(revision) FROM (SELECT revision FROM snapshots UNION ALL SELECT revision FROM events)";
            if (command.ExecuteScalar() is not long currentRevision) return new DocumentStateReadResult("DOCUMENT_NOT_FOUND");
            if (revision > currentRevision) return new DocumentStateReadResult("INVALID_REVISION");
            try
            {
                var historical = Recover(connection, transaction, documentId, revision);
                return historical is null ? new DocumentStateReadResult("REVISION_UNAVAILABLE") : new DocumentStateReadResult("OK", historical);
            }
            catch (InvalidDataException) { return new DocumentStateReadResult("REVISION_UNAVAILABLE"); }
            catch (JsonException) { return new DocumentStateReadResult("REVISION_UNAVAILABLE"); }
        }, cancellationToken);

    public Task<DocumentReconnectResult> ReadEventsAsync(Guid documentId, long lastSeenRevision,
        CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            if (documentId == Guid.Empty) return new DocumentReconnectResult("INVALID_ID");
            if (lastSeenRevision < 0) return new DocumentReconnectResult("INVALID_REVISION");
            using var connection = Open(documentId);
            // Recovery and event selection share one read transaction, including during concurrent commits.
            using var transaction = connection.BeginTransaction(deferred: true);
            var state = Recover(connection, transaction, documentId);
            if (state is null) return new DocumentReconnectResult("DOCUMENT_NOT_FOUND");
            if (lastSeenRevision > state.Revision) return new DocumentReconnectResult("INVALID_REVISION");
            if (state.Revision - lastSeenRevision > MaxReconnectEvents)
                return new DocumentReconnectResult("SNAPSHOT", state.Revision, Snapshot: state);
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = EventProjection + " WHERE e.revision>$revision AND e.revision<=$current ORDER BY e.revision";
            command.Parameters.AddWithValue("$revision", lastSeenRevision);
            command.Parameters.AddWithValue("$current", state.Revision);
            using var reader = command.ExecuteReader();
            var events = new List<CommittedDocumentEvent>();
            var revision = lastSeenRevision;
            var payloadBytes = 0;
            while (reader.Read())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (reader.GetInt64(0) != revision + 1)
                    return new DocumentReconnectResult("SNAPSHOT", state.Revision, Snapshot: state);
                var payload = ReadEvent(reader);
                payloadBytes += JsonSerializer.SerializeToUtf8Bytes(payload, payload.GetType()).Length;
                if (payloadBytes > MaxReconnectPayloadBytes)
                    return new DocumentReconnectResult("SNAPSHOT", state.Revision, Snapshot: state);
                events.Add(new(documentId, ++revision, Guid.Parse(reader.GetString(8)),
                    reader.GetString(9), reader.GetString(1), payload) { Source = reader.GetString(15) });
            }
            return revision == state.Revision
                ? new DocumentReconnectResult("EVENTS", state.Revision, events)
                : new DocumentReconnectResult("SNAPSHOT", state.Revision, Snapshot: state);
        }, cancellationToken);

    private static DocumentEvent ReadEvent(SqliteDataReader reader)
    {
        var subjectId = Guid.Parse(reader.GetString(2));
        return reader.GetString(1) switch
        {
            "EXECUTE_BATCH" when !reader.IsDBNull(14)
                => JsonSerializer.Deserialize<DocumentEvent>(reader.GetString(14)) is BatchApplied batch
                    ? batch : throw new InvalidDataException("Invalid batch payload."),
            "RENAME_DOCUMENT" or "UPLOAD_ASSET" or "DELETE_PAGE" or "CREATE_SCENARIO" or "UPDATE_SCENARIO" or "DELETE_SCENARIO" or "DUPLICATE_SCREEN" or "ADD_SCREEN_VARIANT" or "SET_SCREEN_VARIANT_OVERRIDE" or "REMOVE_SCREEN_VARIANT_OVERRIDE" or "SET_SCREEN_VARIANT_PROPERTIES" or "IMPORT_DESIGN_TOKENS" or "SET_NODE_REPEATER" or "BIND_NODE_DATA" or "UNBIND_NODE_DATA" or "SET_DATASET_CONNECTOR" or "REMOVE_DATASET_CONNECTOR" or "DELETE_DATASET" or "ADD_DATASET" or "REPLACE_DATASET_FIXTURE" or "DELETE_COMPONENT_DEFINITION" or "SET_COMPONENT_VARIANT_PARAMETER_CHANGE" or "REMOVE_COMPONENT_VARIANT_PARAMETER_CHANGE" or "SET_COMPONENT_PARAMETER_DEFAULT" or "ADD_COMPONENT_SLOT" or "SET_COMPONENT_SLOT_CONTENT" or "ADD_COMPONENT_VARIANT" or "SET_COMPONENT_INSTANCE_VARIANT" or "SET_COMPONENT_PARAMETER_OVERRIDE" or "ADD_COMPONENT_PARAMETER" or "DETACH_COMPONENT_INSTANCE" or "INSERT_COMPONENT_INSTANCE" or "ADD_COMPONENT_DEFINITION" or "ADD_TOKEN" or "DELETE_TOKEN" or "RENAME_TOKEN" or "SET_TOKEN_VALUE" or "UPSERT_STYLE" or "DELETE_STYLE" or "REMOVE_NODE_PROPERTIES" or "SET_NODE_NAME" or "SET_NODE_SEMANTIC_KEY" or "RENAME_PAGE" or "RENAME_SCREEN" or "ADD_SCREEN" or "RESIZE_SCREEN" when !reader.IsDBNull(14)
                => JsonSerializer.Deserialize<DocumentEvent>(reader.GetString(14)) ?? throw new InvalidDataException("Missing event payload."),
            "SET_NODE_PROPERTIES" when !reader.IsDBNull(14)
                => JsonSerializer.Deserialize<DocumentEvent>(reader.GetString(14)) is NodePropertiesSet properties &&
                    properties.NodeId == subjectId && properties.Properties is { Count: > 0 }
                    ? properties : throw new InvalidDataException("Invalid node properties event."),
            "SET_NODE_PROPERTY" when !reader.IsDBNull(12) && !reader.IsDBNull(13)
                => new NodePropertySet(subjectId, reader.GetString(12), JsonSerializer.Deserialize<NodePropertyValue>(reader.GetString(13))
                    ?? throw new InvalidDataException("Missing property value.")),
            "UNDO" or "REDO" when !reader.IsDBNull(11)
                => JsonSerializer.Deserialize<HistoryCompensated>(reader.GetString(11))
                    ?? throw new InvalidDataException("Missing compensation payload."),
            "RESTORE_VERSION" when reader.IsDBNull(3) && reader.IsDBNull(4) && reader.IsDBNull(6) && !reader.IsDBNull(10)
                => new VersionRestored(subjectId, JsonSerializer.Deserialize<DocumentStructure>(reader.GetString(10))
                    ?? throw new InvalidDataException("Missing restored document.")),
            "SAVE_VERSION" when reader.IsDBNull(3) && reader.IsDBNull(4) && reader.IsDBNull(6)
                => new VersionSaved(subjectId),
            "ADD_PAGE" when reader.IsDBNull(3) && reader.IsDBNull(4) && reader.IsDBNull(6)
                => reader.IsDBNull(14) ? new PageAdded(subjectId)
                    : JsonSerializer.Deserialize<DocumentEvent>(reader.GetString(14)) is PageAdded page && page.PageId == subjectId
                        ? page : throw new InvalidDataException("Invalid page creation payload."),
            "ADD_NODE" when reader.IsDBNull(3) && !reader.IsDBNull(4) && !reader.IsDBNull(5) && reader.IsDBNull(6)
                => ReadNodeAdded(reader, subjectId),
            "MOVE_NODE" when reader.IsDBNull(3) && reader.IsDBNull(4) && !reader.IsDBNull(6) && !reader.IsDBNull(7)
                => new NodeMoved(subjectId, Guid.Parse(reader.GetString(6)), reader.GetInt32(7)),
            "DELETE_NODE" when reader.IsDBNull(3) && reader.IsDBNull(4) && reader.IsDBNull(6)
                => new NodeDeleted(subjectId),
            _ => throw new InvalidDataException("Invalid document event type or payload.")
        };
    }

    private static NodeAdded ReadNodeAdded(SqliteDataReader reader, Guid parentId)
    {
        var nodeId = Guid.Parse(reader.GetString(4));
        var kind = reader.GetString(5);
        if (reader.IsDBNull(14)) return new(parentId, nodeId, kind);
        var payload = reader.GetString(14);
        using var json = JsonDocument.Parse(payload);
        // Legacy node events stored only their property map. New named events use the
        // same polymorphic event payload as the other metadata-bearing events.
        if (json.RootElement.TryGetProperty("payloadType", out var discriminator) &&
            discriminator.ValueKind == JsonValueKind.String)
            return JsonSerializer.Deserialize<DocumentEvent>(payload) is NodeAdded node &&
                node.ParentId == parentId && node.NodeId == nodeId && node.Kind == kind
                ? node : throw new InvalidDataException("Invalid node creation payload.");
        return new(parentId, nodeId, kind,
            JsonSerializer.Deserialize<ImmutableSortedDictionary<string, NodePropertyValue>>(payload)
                ?? throw new InvalidDataException("Missing initial node properties."));
    }

    public async Task<CommandResult?> ReadResultAsync(Guid documentId, Guid commandId, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (!await CanEditAsync(actor, documentId, cancellationToken)) return null;
        using var connection = Open(documentId);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT result FROM results WHERE command_id=$id";
        command.Parameters.AddWithValue("$id", commandId.ToString());
        return command.ExecuteScalar() is string original ? JsonSerializer.Deserialize<CommandResult>(original) : null;
    }

    public Task<CommandResult> ExecuteAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Func<Guid, DocumentVersionResult>, Func<string, IReadOnlyList<DocumentCommandHistoryEntry>>, DocumentChange> apply, CancellationToken cancellationToken = default,
        Func<ValueTask<CommandResult?>>? authorize = null)
        => ExecuteCoreAsync(documentId, commandId, (state, version, history) => Task.FromResult(apply(state, version, history)), cancellationToken, authorize);

    public Task<CommandResult> ExecuteBatchAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Task<DocumentChange>> apply, CancellationToken cancellationToken,
        Func<ValueTask<CommandResult?>> authorize)
        => ExecuteCoreAsync(documentId, commandId, (state, _, _) => apply(state), cancellationToken, authorize);

    private Task<CommandResult> ExecuteCoreAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Func<Guid, DocumentVersionResult>, Func<string, IReadOnlyList<DocumentCommandHistoryEntry>>, Task<DocumentChange>> apply,
        CancellationToken cancellationToken, Func<ValueTask<CommandResult?>>? authorize)
        => Task.Run(async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var connection = Open(documentId);
            // BEGIN IMMEDIATE takes the cross-process writer lock before recovery or deduplication.
            using var transaction = connection.BeginTransaction(deferred: false);
            if (authorize is not null && await authorize() is { } denial) return denial;
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT result FROM results WHERE command_id=$id";
            command.Parameters.AddWithValue("$id", commandId.ToString());
            if (command.ExecuteScalar() is string original)
                return JsonSerializer.Deserialize<CommandResult>(original)!;

            var previous = Recover(connection, transaction, documentId);
            var change = await apply(previous, versionId =>
            {
                try { return ReadVersion(connection, transaction, documentId, versionId); }
                catch (InvalidDataException) { return new("INVALID_VERSION"); }
            }, actorId => ReadHistory(connection, transaction, actorId));
            if (change.Result.DocumentId != documentId || change.Result.CommandId != commandId)
                throw new InvalidOperationException("Command result identity mismatch.");
            if (change.State is { } next)
            {
                if (!change.Result.Accepted || previous is null || next.Revision != checked(previous.Revision + 1) ||
                    next.Document.Id != documentId || change.Result.Revision != next.Revision)
                    throw new InvalidOperationException("Invalid document transaction.");
                Validate(next.Document);
                var (eventType, subjectId, screenId, nodeId, kind) = change.Event switch
                {
                    BatchApplied batch when JsonSerializer.Serialize(batch.Patch.Apply(previous.Document)) == JsonSerializer.Serialize(next.Document)
                        => ("EXECUTE_BATCH", documentId, (Guid?)null, (Guid?)null, (string?)null),
                    DocumentDeleted => ("DELETE_DOCUMENT", documentId, (Guid?)null, (Guid?)null, (string?)null),
                    HistoryCompensated compensation when change.Version is null
                        => (compensation.IsRedo ? "REDO" : "UNDO", compensation.TargetCommandId, (Guid?)null, (Guid?)null, (string?)null),
                    VersionRestored restored when change.Version is null && change.Result.VersionId == restored.VersionId &&
                        JsonSerializer.Serialize(restored.Document) == JsonSerializer.Serialize(next.Document)
                        => ("RESTORE_VERSION", restored.VersionId, (Guid?)null, (Guid?)null, (string?)null),
                    VersionSaved saved when change.Result.VersionId == saved.VersionId && change.Version is not null
                        => ("SAVE_VERSION", saved.VersionId, (Guid?)null, (Guid?)null, (string?)null),
                    AssetAdded asset => ("UPLOAD_ASSET", asset.Asset.Id, (Guid?)null, (Guid?)null, (string?)null),
                    PageDeleted page when change.Result.PageId == page.PageId
                        => ("DELETE_PAGE", page.PageId, (Guid?)null, (Guid?)null, (string?)null),
                    PageAdded page when change.Version is null && change.Result.PageId == page.PageId && change.Result.ScreenId is null
                        => ("ADD_PAGE", page.PageId, (Guid?)null, (Guid?)null, (string?)null),
                    ScreenAdded screen when change.Result.PageId == screen.PageId && change.Result.ScreenId == screen.ScreenId
                        => ("ADD_SCREEN", screen.PageId, (Guid?)screen.ScreenId, (Guid?)null, (string?)null),
                    ScreenDuplicated screen when change.Result.ScreenId == screen.ScreenId &&
                        JsonSerializer.Serialize(screen.Patch.Apply(previous.Document)) == JsonSerializer.Serialize(next.Document)
                        => ("DUPLICATE_SCREEN", screen.ScreenId, (Guid?)null, (Guid?)null, (string?)null),
                    ScreenResized screen => ("RESIZE_SCREEN", screen.ScreenId, (Guid?)null, (Guid?)null, (string?)null),
                    ScreenRenamed screen when change.Result.ScreenId == screen.ScreenId => ("RENAME_SCREEN", screen.ScreenId, (Guid?)null, (Guid?)null, (string?)null),
                    ScenarioChanged scenario => (scenario.Operation, scenario.ScenarioId, (Guid?)null, (Guid?)null, (string?)null),
                    ScreenVariantChanged variant => (variant.Operation, variant.ScreenId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeRepeaterSet repeater => ("SET_NODE_REPEATER", repeater.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeDataBindingSet binding => (binding.Binding is null ? "UNBIND_NODE_DATA" : "BIND_NODE_DATA", binding.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    DatasetConnectorSet dataset => (dataset.ConnectorId is null ? "REMOVE_DATASET_CONNECTOR" : "SET_DATASET_CONNECTOR", dataset.DatasetId, (Guid?)null, (Guid?)null, (string?)null),
                    DatasetDeleted dataset => ("DELETE_DATASET", dataset.DatasetId, (Guid?)null, (Guid?)null, (string?)null),
                    DatasetAdded dataset => ("ADD_DATASET", dataset.Dataset.Id, (Guid?)null, (Guid?)null, (string?)null),
                    DatasetFixtureReplaced dataset => ("REPLACE_DATASET_FIXTURE", dataset.DatasetId, (Guid?)null, (Guid?)null, (string?)null),
                    TokenValueSet token => ("SET_TOKEN_VALUE", token.TokenId, (Guid?)null, (Guid?)null, (string?)null),
                    TokenRenamed token => ("RENAME_TOKEN", token.TokenId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentDefinitionDeleted component when JsonSerializer.Serialize(component.Patch.Apply(previous.Document)) == JsonSerializer.Serialize(next.Document)
                        => ("DELETE_COMPONENT_DEFINITION", component.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentInstanceDetached instance when change.Result.NodeId == instance.NodeId &&
                        JsonSerializer.Serialize(instance.Patch.Apply(previous.Document)) == JsonSerializer.Serialize(next.Document)
                        => ("DETACH_COMPONENT_INSTANCE", instance.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentInstanceInserted instance => ("INSERT_COMPONENT_INSTANCE", instance.Instance.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentVariantParameterChangeSet parameter => (parameter.Value is null ? "REMOVE_COMPONENT_VARIANT_PARAMETER_CHANGE" : "SET_COMPONENT_VARIANT_PARAMETER_CHANGE", parameter.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentParameterDefaultSet parameter => ("SET_COMPONENT_PARAMETER_DEFAULT", parameter.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentSlotAdded slot => ("ADD_COMPONENT_SLOT", slot.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentSlotContentSet slot => ("SET_COMPONENT_SLOT_CONTENT", slot.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentVariantAdded variant => ("ADD_COMPONENT_VARIANT", variant.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentInstanceVariantSet variant => ("SET_COMPONENT_INSTANCE_VARIANT", variant.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentParameterOverrideSet parameter => ("SET_COMPONENT_PARAMETER_OVERRIDE", parameter.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentParameterAdded parameter => ("ADD_COMPONENT_PARAMETER", parameter.DefinitionId, (Guid?)null, (Guid?)null, (string?)null),
                    ComponentDefinitionAdded component => ("ADD_COMPONENT_DEFINITION", component.Definition.Id, (Guid?)null, (Guid?)null, (string?)null),
                    TokensImported => ("IMPORT_DESIGN_TOKENS", documentId, (Guid?)null, (Guid?)null, (string?)null),
                    TokenAdded token => ("ADD_TOKEN", token.Token.Id, (Guid?)null, (Guid?)null, (string?)null),
                    TokenDeleted token => ("DELETE_TOKEN", token.TokenId, (Guid?)null, (Guid?)null, (string?)null),
                    StyleUpserted style => ("UPSERT_STYLE", style.Style.Id, (Guid?)null, (Guid?)null, (string?)null),
                    StyleDeleted style => ("DELETE_STYLE", style.StyleId, (Guid?)null, (Guid?)null, (string?)null),
                    NodePropertiesRemoved removed => ("REMOVE_NODE_PROPERTIES", removed.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    DocumentRenamed => ("RENAME_DOCUMENT", documentId, (Guid?)null, (Guid?)null, (string?)null),
                    PageRenamed page when change.Result.PageId == page.PageId
                        => ("RENAME_PAGE", page.PageId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeNameSet name when change.Result.NodeId == name.NodeId
                        => ("SET_NODE_NAME", name.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeSemanticKeySet key when change.Result.NodeId == key.NodeId
                        => ("SET_NODE_SEMANTIC_KEY", key.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodePropertySet property when change.Result.NodeId == property.NodeId && change.Result.Property == property.Property
                        => ("SET_NODE_PROPERTY", property.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodePropertiesSet properties when change.Result.NodeId == properties.NodeId && properties.Properties is { Count: > 0 }
                        => ("SET_NODE_PROPERTIES", properties.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeMoved node when change.Result.NodeId == node.NodeId && change.Result.PageId is null && change.Result.ScreenId is null
                        => ("MOVE_NODE", node.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeDeleted node when change.Result.NodeId == node.NodeId && change.Result.PageId is null && change.Result.ScreenId is null
                        => ("DELETE_NODE", node.NodeId, (Guid?)null, (Guid?)null, (string?)null),
                    NodeAdded node when change.Result.NodeId == node.NodeId && change.Result.PageId is null && change.Result.ScreenId is null
                        => ("ADD_NODE", node.ParentId, (Guid?)null, (Guid?)node.NodeId, node.Kind),
                    _ => throw new InvalidOperationException("Invalid document event.")
                };
                StoreAssetContent(connection, transaction, change);
                ValidateStoredAssets(connection, transaction, next.Document);
                if (change.Event is VersionSaved savedEvent)
                {
                    var version = change.Version!;
                    if (version.Id != savedEvent.VersionId || version.Timestamp != change.Result.Timestamp ||
                        version.AuthorId != change.Result.ActorId || version.Snapshot.Revision != next.Revision ||
                        JsonSerializer.Serialize(version.Snapshot.Document) != JsonSerializer.Serialize(previous.Document) ||
                        JsonSerializer.Serialize(next.Document) != JsonSerializer.Serialize(previous.Document))
                        throw new InvalidOperationException("Invalid saved version transaction.");
                    var payload = JsonSerializer.Serialize(version);
                    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
                    VerifyVersion(payload, hash, documentId, version.Id);
                    command.CommandText = "INSERT INTO user_versions(version_id,revision,payload,sha256) VALUES($version,$versionRevision,$payload,$hash)";
                    command.Parameters.AddWithValue("$version", version.Id.ToString());
                    command.Parameters.AddWithValue("$versionRevision", version.Snapshot.Revision);
                    command.Parameters.AddWithValue("$payload", payload);
                    command.Parameters.AddWithValue("$hash", hash);
                    command.ExecuteNonQuery();
                    // Verify the stored bytes before the transaction can become visible.
                    command.CommandText = "SELECT payload,sha256 FROM user_versions WHERE version_id=$version";
                    using var stored = command.ExecuteReader();
                    if (!stored.Read()) throw new InvalidDataException("Saved version was not stored.");
                    VerifyVersion(stored.GetString(0), (byte[])stored[1], documentId, version.Id);
                }
                else if (change.Version is not null || (change.Result.VersionId is not null && change.Event is not VersionRestored))
                    throw new InvalidOperationException("Unexpected saved version payload.");
                command.CommandText = """
                    INSERT INTO events(revision,command_id,actor_id,timestamp,type,subject_id)
                    VALUES($revision,$id,$actor,$time,$type,$page)
                    """;
                command.Parameters.AddWithValue("$revision", next.Revision);
                command.Parameters.AddWithValue("$actor", change.Result.ActorId);
                command.Parameters.AddWithValue("$time", change.Result.Timestamp.ToString("O"));
                command.Parameters.AddWithValue("$type", eventType);
                command.Parameters.AddWithValue("$page", subjectId.ToString());
                command.ExecuteNonQuery();
                if (screenId is { } id)
                {
                    command.CommandText = "INSERT INTO screen_events(revision,screen_id) VALUES($revision,$screen)";
                    command.Parameters.AddWithValue("$screen", id.ToString());
                    command.ExecuteNonQuery();
                }
                if (nodeId is { } addedNodeId)
                {
                    command.CommandText = "INSERT INTO node_events(revision,node_id,kind) VALUES($revision,$node,$kind)";
                    command.Parameters.AddWithValue("$node", addedNodeId.ToString());
                    command.Parameters.AddWithValue("$kind", kind!);
                    command.ExecuteNonQuery();
                }
                if (change.Event is BatchApplied or NodeAdded { Properties: not null } or NodeAdded { Name: not null } or PageAdded { Name: not null } or NodePropertiesSet or DocumentDeleted or DocumentRenamed or AssetAdded or PageDeleted or ScreenAdded or ScreenDuplicated or ScreenResized or ScreenRenamed or PageRenamed or ScenarioChanged or ScreenVariantChanged or TokensImported or NodeRepeaterSet or NodeDataBindingSet or DatasetConnectorSet or DatasetDeleted or DatasetAdded or DatasetFixtureReplaced or ComponentDefinitionDeleted or ComponentVariantParameterChangeSet or ComponentParameterDefaultSet or ComponentSlotAdded or ComponentSlotContentSet or ComponentVariantAdded or ComponentInstanceVariantSet or ComponentParameterOverrideSet or ComponentParameterAdded or ComponentInstanceDetached or ComponentInstanceInserted or ComponentDefinitionAdded or TokenAdded or TokenDeleted or TokenRenamed or TokenValueSet or StyleUpserted or StyleDeleted or NodePropertiesRemoved or NodeNameSet or NodeSemanticKeySet)
                {
                    command.CommandText = "INSERT INTO payload_events(revision,payload) VALUES($revision,$metadata)";
                    command.Parameters.AddWithValue("$metadata", change.Event is NodeAdded { Name: null } added
                        ? JsonSerializer.Serialize(added.Properties)
                        : JsonSerializer.Serialize<DocumentEvent>(change.Event));
                    command.ExecuteNonQuery();
                }
                if (change.Event is NodePropertySet propertyEvent)
                {
                    command.CommandText = "INSERT INTO property_events(revision,property,value) VALUES($revision,$property,$value)";
                    command.Parameters.AddWithValue("$property", propertyEvent.Property);
                    command.Parameters.AddWithValue("$value", JsonSerializer.Serialize<NodePropertyValue>(propertyEvent.Value));
                    command.ExecuteNonQuery();
                }
                if (change.Event is NodeMoved move)
                {
                    command.CommandText = "INSERT INTO move_events(revision,parent_id,position) VALUES($revision,$parent,$position)";
                    command.Parameters.AddWithValue("$parent", move.TargetParentId.ToString());
                    command.Parameters.AddWithValue("$position", move.Position);
                    command.ExecuteNonQuery();
                }
                if (change.Event is VersionRestored restoredEvent)
                {
                    command.CommandText = "INSERT INTO restore_events(revision,document) VALUES($revision,$restoredDocument)";
                    command.Parameters.AddWithValue("$restoredDocument", JsonSerializer.Serialize(restoredEvent.Document));
                    command.ExecuteNonQuery();
                }
                if (change.Event is HistoryCompensated compensationEvent)
                {
                    command.CommandText = "INSERT INTO compensation_events(revision,payload) VALUES($revision,$compensation)";
                    command.Parameters.AddWithValue("$compensation", JsonSerializer.Serialize(compensationEvent));
                    command.ExecuteNonQuery();
                    command.CommandText = "UPDATE command_history SET status=$status,history_order=$revision WHERE command_id=$target AND actor_id=$actor";
                    command.Parameters.AddWithValue("$status", compensationEvent.IsRedo ? "ACTIVE" : "UNDONE");
                    command.Parameters.AddWithValue("$target", compensationEvent.TargetCommandId.ToString());
                    if (command.ExecuteNonQuery() != 1) throw new InvalidOperationException("Compensation history mismatch.");
                }
                else if (change.Event is not (VersionSaved or DocumentDeleted))
                {
                    command.CommandText = "UPDATE command_history SET status='DISCARDED' WHERE actor_id=$actor AND status='UNDONE'";
                    command.ExecuteNonQuery();
                }
                if (change.Event is not (VersionSaved or DocumentDeleted))
                {
                    command.CommandText = "SELECT DISTINCT actor_id FROM command_history WHERE status='UNDONE'";
                    var redoActors = new List<string>();
                    using (var redoReader = command.ExecuteReader())
                        while (redoReader.Read()) redoActors.Add(redoReader.GetString(0));
                    command.Parameters.AddWithValue("$redoActor", "");
                    foreach (var redoActor in redoActors)
                    {
                        var candidate = next.Document;
                        var compatible = true;
                        foreach (var entry in ReadHistory(connection, transaction, redoActor)
                            .Where(e => e.Status == "UNDONE").OrderByDescending(e => e.HistoryOrder))
                        {
                            var applied = entry.Patch!.Apply(candidate);
                            if (applied is null || DocumentStructureValidator.Validate(applied, profile).Count != 0)
                            {
                                compatible = false;
                                break;
                            }
                            candidate = applied;
                        }
                        if (!compatible)
                        {
                            command.CommandText = "UPDATE command_history SET status='DISCARDED' WHERE actor_id=$redoActor AND status='UNDONE'";
                            command.Parameters["$redoActor"].Value = redoActor;
                            command.ExecuteNonQuery();
                        }
                    }
                }
                var patch = change.Event is DocumentDeleted or VersionSaved or HistoryCompensated ? null : DocumentPatch.Between(previous.Document, next.Document);
                // Only adjacent, compatible edits from the same actor and editing session
                // may merge. Preserve every event/result for recovery and idempotency.
                if (patch is not null && change.HistoryGroupId is { } groupId && groupId != Guid.Empty)
                {
                    string? previousCommand = null;
                    DocumentPatch? previousPatch = null;
                    using (var lookup = connection.CreateCommand())
                    {
                        lookup.Transaction = transaction;
                        lookup.CommandText = """
                            SELECT h.command_id,h.patch FROM command_history h
                            JOIN command_history_groups g ON g.command_id=h.command_id
                            JOIN events e ON e.command_id=h.command_id
                            WHERE h.actor_id=$actor AND h.status='ACTIVE' AND h.type=$type
                              AND g.group_id=$group AND h.history_order=$previous AND e.revision=$previous
                              AND e.subject_id=$subject
                            """;
                        lookup.Parameters.AddWithValue("$actor", change.Result.ActorId);
                        lookup.Parameters.AddWithValue("$type", eventType);
                        lookup.Parameters.AddWithValue("$group", groupId.ToString());
                        lookup.Parameters.AddWithValue("$previous", previous.Revision);
                        lookup.Parameters.AddWithValue("$subject", subjectId.ToString());
                        using var reader = lookup.ExecuteReader();
                        if (reader.Read() && !reader.IsDBNull(1))
                        {
                            previousCommand = reader.GetString(0);
                            previousPatch = JsonSerializer.Deserialize<DocumentPatch>(reader.GetString(1));
                        }
                    }
                    if (previousPatch?.Reverse().Apply(previous.Document) is { } groupStart)
                    {
                        patch = DocumentPatch.Between(groupStart, next.Document);
                        command.CommandText = "UPDATE command_history SET status='GROUPED' WHERE command_id=$grouped AND status='ACTIVE'";
                        command.Parameters.AddWithValue("$grouped", previousCommand!);
                        if (command.ExecuteNonQuery() != 1) throw new InvalidOperationException("Edit history group mismatch.");
                    }
                    command.CommandText = "INSERT INTO command_history_groups(command_id,group_id) VALUES($id,$groupId)";
                    command.Parameters.AddWithValue("$groupId", groupId.ToString());
                    command.ExecuteNonQuery();
                }
                command.CommandText = "INSERT INTO command_history(command_id,actor_id,result,type,patch,status,history_order) VALUES($id,$actor,$historyResult,$type,$patch,$historyStatus,$revision)";
                command.Parameters.AddWithValue("$historyResult", JsonSerializer.Serialize(change.Result));
                command.Parameters.AddWithValue("$patch", patch is null ? DBNull.Value : JsonSerializer.Serialize(patch));
                command.Parameters.AddWithValue("$historyStatus", patch is null ? "RECORDED" : "ACTIVE");
                command.ExecuteNonQuery();
                WriteMetadata(connection, transaction, next.Document, next.Revision, null, change.Result.Timestamp);
                if (next.Revision % SnapshotInterval == 0)
                {
                    command.CommandText = "INSERT INTO snapshots(revision,document) VALUES($revision,$document)";
                    command.Parameters.AddWithValue("$document", JsonSerializer.Serialize(next.Document));
                    command.ExecuteNonQuery();
                }
            }
            else if (change.Result.Accepted || change.Event is not null || change.Version is not null)
                throw new InvalidOperationException("Accepted commands must change state.");
            if (change.Event is DocumentDeleted)
            {
                command.CommandText = "INSERT INTO document_deletion(singleton,revision) VALUES(1,$revision)";
                command.ExecuteNonQuery();
            }
            command.CommandText = "INSERT INTO results(command_id,result) VALUES($id,$result)";
            command.Parameters.AddWithValue("$result", JsonSerializer.Serialize(change.Result));
            command.ExecuteNonQuery();
            cancellationToken.ThrowIfCancellationRequested();
            if (change.Event is BatchApplied && authorize is not null && await authorize() is { } finalDenial) return finalDenial;
            cancellationToken.ThrowIfCancellationRequested();
            transaction.Commit();
            return change.Result;
        }, cancellationToken);

    public Task<DocumentCommandHistoryResult> ReadHistoryAsync(Guid documentId, string actorId, CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            if (Recover(connection, transaction, documentId) is null) return new DocumentCommandHistoryResult("DOCUMENT_NOT_FOUND");
            return new DocumentCommandHistoryResult("HISTORY", ReadHistory(connection, transaction, actorId));
        }, cancellationToken);

    private static IReadOnlyList<DocumentCommandHistoryEntry> ReadHistory(SqliteConnection connection, SqliteTransaction transaction, string actorId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT result,type,patch,status,history_order FROM command_history WHERE actor_id=$actor ORDER BY history_order,command_id";
        command.Parameters.AddWithValue("$actor", actorId);
        using var reader = command.ExecuteReader();
        var entries = new List<DocumentCommandHistoryEntry>();
        while (reader.Read()) entries.Add(new(JsonSerializer.Deserialize<CommandResult>(reader.GetString(0))!,
            reader.GetString(1), reader.IsDBNull(2) ? null : JsonSerializer.Deserialize<DocumentPatch>(reader.GetString(2)),
            reader.GetString(3), reader.GetInt64(4)));
        return entries.OrderBy(entry => entry.Result.Revision).ToArray();
    }

    public Task<DocumentVersionListResult> ListVersionsAsync(Guid documentId, int limit, long? beforeRevision,
        CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            if (documentId == Guid.Empty) return new DocumentVersionListResult("INVALID_ID");
            if (limit is < 1 or > 100 || beforeRevision is <= 0) return new DocumentVersionListResult("INVALID_PAGE");
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            if (IsDeleted(connection, transaction)) return new DocumentVersionListResult("DOCUMENT_NOT_FOUND");
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                SELECT version_id,revision,payload,sha256 FROM user_versions
                WHERE ($before IS NULL OR revision < $before) ORDER BY revision DESC LIMIT $limit
                """;
            command.Parameters.AddWithValue("$before", (object?)beforeRevision ?? DBNull.Value);
            command.Parameters.AddWithValue("$limit", limit + 1);
            using var reader = command.ExecuteReader();
            var versions = new List<DocumentVersionMetadata>();
            var hasMore = false;
            while (reader.Read())
            {
                cancellationToken.ThrowIfCancellationRequested();
                var id = Guid.Parse(reader.GetString(0));
                var revision = reader.GetInt64(1);
                var version = VerifyVersion(reader.GetString(2), (byte[])reader[3], documentId, id);
                if (version.Snapshot.Revision != revision) throw new InvalidDataException("Saved version revision mismatch.");
                if (versions.Count == limit) { hasMore = true; break; }
                versions.Add(new(version.Id, version.Name, version.Timestamp, version.AuthorId, revision));
            }
            return new DocumentVersionListResult("VERSIONS", versions, hasMore ? versions[^1].Revision : null);
        }, cancellationToken);

    public Task<DocumentVersionResult> ReadVersionAsync(Guid documentId, Guid versionId,
        CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            return IsDeleted(connection, transaction) ? new DocumentVersionResult("DOCUMENT_NOT_FOUND") : ReadVersion(connection, transaction, documentId, versionId);
        }, cancellationToken);

    private DocumentVersionResult ReadVersion(SqliteConnection connection, SqliteTransaction? transaction,
        Guid documentId, Guid versionId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT payload,sha256,revision FROM user_versions WHERE version_id=$id";
        command.Parameters.AddWithValue("$id", versionId.ToString());
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return new("VERSION_NOT_FOUND");
        var version = VerifyVersion(reader.GetString(0), (byte[])reader[1], documentId, versionId);
        if (version.Snapshot.Revision != reader.GetInt64(2)) throw new InvalidDataException("Saved version revision mismatch.");
        ValidateStoredAssets(connection, transaction, version.Snapshot.Document);
        return new("VERSION", version);
    }

    private SavedDocumentVersion VerifyVersion(string payload, byte[] hash, Guid documentId, Guid versionId)
    {
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(payload)), hash))
            throw new InvalidDataException("Saved version integrity check failed.");
        SavedDocumentVersion version;
        try
        {
            version = JsonSerializer.Deserialize<SavedDocumentVersion>(payload)
                ?? throw new InvalidDataException("Saved version is empty.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Saved version serialization is invalid.", error);
        }
        if (version.Id != versionId || version.Snapshot is null || version.Snapshot.Document is null ||
            version.Snapshot.Document.Id != documentId ||
            version.Snapshot.Revision < 1 || string.IsNullOrWhiteSpace(version.AuthorId))
            throw new InvalidDataException("Saved version identity is invalid.");
        Validate(version.Snapshot.Document);
        if (JsonSerializer.Serialize(version) != payload)
            throw new InvalidDataException("Saved version serialization is not deterministic.");
        return version;
    }

    private static bool IsDeleted(SqliteConnection connection, SqliteTransaction? transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM document_deletion)";
        return (long)command.ExecuteScalar()! != 0;
    }

    private DocumentState? Recover(SqliteConnection connection, SqliteTransaction transaction, Guid documentId, long? targetRevision = null)
    {
        if (IsDeleted(connection, transaction)) return null;
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT revision,document FROM snapshots WHERE revision<=$target ORDER BY revision DESC LIMIT 1";
        command.Parameters.AddWithValue("$target", targetRevision ?? long.MaxValue);
        DocumentState state;
        using (var reader = command.ExecuteReader())
        {
            if (!reader.Read()) return null;
            state = new(JsonSerializer.Deserialize<DocumentStructure>(reader.GetString(1))!, reader.GetInt64(0));
        }
        if (state.Document.Id != documentId) throw new InvalidDataException("Document identity mismatch.");
        ValidateProfile(state.Document);
        command.CommandText = EventProjection + " WHERE e.revision>$revision AND e.revision<=$target ORDER BY e.revision";
        command.Parameters.AddWithValue("$revision", state.Revision);
        using (var reader = command.ExecuteReader())
        {
            var document = state.Document;
            var revision = state.Revision;
            while (reader.Read())
            {
                if (reader.GetInt64(0) != checked(revision + 1))
                    throw new InvalidDataException("Invalid document journal sequence.");
                switch (ReadEvent(reader))
                {
                    case AssetAdded asset:
                        document = asset.Apply(document);
                        break;
                    case BatchApplied batch:
                        document = batch.Patch.Apply(document)
                            ?? throw new InvalidDataException("Batch preconditions failed during recovery.");
                        break;
                    case HistoryCompensated compensation:
                        document = compensation.Patch.Apply(document)
                            ?? throw new InvalidDataException("Compensation preconditions failed during recovery.");
                        break;
                    case VersionRestored restored:
                        if (restored.Document.Id != documentId)
                            throw new InvalidDataException("Restored document identity mismatch.");
                        Validate(restored.Document);
                        document = restored.Document;
                        break;
                    case VersionSaved:
                        break;
                    case ScenarioChanged scenario:
                        document = DocumentScenarioEditor.Set(document, scenario.ScenarioId, scenario.Scenario);
                        break;
                    case ScreenVariantChanged variant:
                        document = ScreenVariantEditor.Set(document, variant.ScreenId, variant.Variant);
                        break;
                    case NodeRepeaterSet repeater:
                        document = DocumentStructureEditor.SetNodeRepeater(document, repeater.NodeId, repeater.Repeater);
                        break;
                    case NodeDataBindingSet binding:
                        if (!document.Nodes.Any(n => n.Id == binding.NodeId)) throw new InvalidDataException("Binding node does not exist.");
                        document = DocumentStructureEditor.SetNodeDataBinding(document, binding.NodeId, binding.Property, binding.Binding);
                        break;
                    case DatasetConnectorSet dataset:
                        if (!document.Datasets.Any(d => d.Id == dataset.DatasetId)) throw new InvalidDataException("Dataset does not exist.");
                        document = document with { Datasets = document.Datasets.Select(d => d.Id == dataset.DatasetId ? d with { ConnectorId = dataset.ConnectorId } : d).ToArray() };
                        break;
                    case DatasetDeleted dataset:
                        if (!document.Datasets.Any(d => d.Id == dataset.DatasetId)) throw new InvalidDataException("Dataset does not exist.");
                        document = document with { Datasets = document.Datasets.Where(d => d.Id != dataset.DatasetId).ToArray() };
                        break;
                    case DatasetAdded dataset:
                        document = document with { Datasets = [.. document.Datasets, dataset.Dataset] };
                        break;
                    case DatasetFixtureReplaced dataset:
                        if (!document.Datasets.Any(d => d.Id == dataset.DatasetId)) throw new InvalidDataException("Dataset does not exist.");
                        document = document with { Datasets = document.Datasets.Select(d => d.Id == dataset.DatasetId ? d with { FixtureJson = dataset.FixtureJson } : d).ToArray() };
                        break;
                    case TokenValueSet token:
                        var existingToken = document.Tokens.FirstOrDefault(t => t.Id == token.TokenId);
                        if (existingToken is null || !Enum.IsDefined(token.Theme) || token.Value is null)
                            throw new InvalidDataException("Token value event references an invalid token or theme.");
                        var values = existingToken.Values.ToDictionary(v => v.Key, v => v.Value);
                        values[token.Theme] = token.Value;
                        document = document with { Tokens = document.Tokens.Select(t => t.Id == token.TokenId ? t with { Values = values } : t).ToArray() };
                        break;
                    case TokenRenamed token:
                        if (!document.Tokens.Any(t => t.Id == token.TokenId) || !FigVam.Domain.Tokens.DesignTokenValidator.IsValidName(token.Name))
                            throw new InvalidDataException("Token rename event references an invalid token or name.");
                        document = document with { Tokens = document.Tokens.Select(t => t.Id == token.TokenId ? t with { Name = token.Name } : t).ToArray() };
                        break;
                    case ComponentDefinitionDeleted deleted:
                        document = deleted.Patch.Apply(document)
                            ?? throw new InvalidDataException("Component deletion preconditions failed during recovery.");
                        break;
                    case ComponentInstanceDetached detached:
                        document = detached.Patch.Apply(document)
                            ?? throw new InvalidDataException("Detachment preconditions failed during recovery.");
                        break;
                    case ComponentInstanceInserted instance:
                        document = DocumentStructureEditor.InsertComponentInstance(document, instance.ParentId, instance.Position, instance.Anchor, instance.Instance);
                        break;
                    case ComponentSlotAdded slot:
                        document = DocumentStructureEditor.AddComponentSlot(document, slot.DefinitionId, slot.Slot);
                        break;
                    case ComponentSlotContentSet slot:
                        document = DocumentStructureEditor.SetComponentSlotContent(document, slot.NodeId, slot.SlotId, slot.ContentNodeIds);
                        break;
                    case ComponentVariantAdded variant:
                        document = DocumentStructureEditor.AddComponentVariant(document, variant.DefinitionId, variant.Variant);
                        break;
                    case ComponentInstanceVariantSet variant:
                        document = DocumentStructureEditor.SetComponentInstanceVariant(document, variant.NodeId, variant.VariantId);
                        break;
                    case ComponentVariantParameterChangeSet parameter:
                        document = DocumentStructureEditor.SetComponentVariantParameterChange(document, parameter.DefinitionId, parameter.VariantId, parameter.ParameterId, parameter.Value);
                        break;
                    case ComponentParameterDefaultSet parameter:
                        document = DocumentStructureEditor.SetComponentParameterDefault(document, parameter.DefinitionId, parameter.ParameterId, parameter.Value);
                        break;
                    case ComponentParameterOverrideSet parameter:
                        document = DocumentStructureEditor.SetComponentParameterOverride(document, parameter.NodeId, parameter.ParameterId, parameter.Value);
                        break;
                    case ComponentParameterAdded parameter:
                        document = DocumentStructureEditor.AddComponentParameter(document, parameter.DefinitionId, parameter.Parameter, parameter.Binding);
                        break;
                    case ComponentDefinitionAdded component:
                        document = document with { ComponentDefinitions = [.. document.ComponentDefinitions, component.Definition] };
                        break;
                    case TokensImported imported:
                        document = document with { Tokens = [.. document.Tokens, .. imported.Tokens] };
                        break;
                    case TokenAdded token:
                        document = document with { Tokens = document.Tokens.Append(token.Token).ToArray() };
                        break;
                    case TokenDeleted token:
                        if (!document.Tokens.Any(t => t.Id == token.TokenId))
                            throw new InvalidDataException("Token delete event refers to a missing token.");
                        document = document with { Tokens = document.Tokens.Where(t => t.Id != token.TokenId).ToArray() };
                        Validate(document);
                        break;
                    case StyleUpserted style:
                        document = document with { Styles = document.Styles.Any(item => item.Id == style.Style.Id)
                            ? document.Styles.Select(item => item.Id == style.Style.Id ? style.Style : item).ToArray()
                            : [.. document.Styles, style.Style] };
                        Validate(document);
                        break;
                    case StyleDeleted style:
                        if (!document.Styles.Any(item => item.Id == style.StyleId))
                            throw new InvalidDataException("Style event references a missing design style.");
                        document = document with { Styles = document.Styles.Where(item => item.Id != style.StyleId).ToArray() };
                        Validate(document);
                        break;
                    case NodePropertiesRemoved removed:
                        var resetTarget = document.Nodes.FirstOrDefault(n => n.Id == removed.NodeId);
                        if (resetTarget is null || removed.Properties is not { Count: > 0 } ||
                            removed.Properties.Any(property => !resetTarget.Properties.ContainsKey(property)))
                            throw new InvalidDataException("Style reset event has invalid node or properties.");
                        document = document with { Nodes = document.Nodes.Select(n => n.Id == removed.NodeId
                            ? n with { Properties = n.Properties.RemoveRange(removed.Properties) } : n).ToArray() };
                        Validate(document);
                        break;
                    case DocumentRenamed renamed:
                        if (!DocumentNameValidator.IsValid(renamed.Name)) throw new InvalidDataException("Invalid document rename event.");
                        document = document with { Name = renamed.Name };
                        break;
                    case PageRenamed page:
                        if (!document.Pages.Any(p => p.Id == page.PageId) || !PageNameValidator.IsValid(page.Name)) throw new InvalidDataException("Invalid page rename event.");
                        document = document with { Pages = document.Pages.Select(p => p.Id == page.PageId ? p with { Name = page.Name } : p).ToArray() };
                        break;
                    case PageDeleted page:
                        document = DocumentStructureEditor.DeletePage(document, page.PageId);
                        break;
                    case PageAdded page:
                        if (page.Name is not null && !PageNameValidator.IsValid(page.Name)) throw new InvalidDataException("Invalid page name in creation event.");
                        document = document with { Pages = document.Pages.Append(new PageStructure(page.PageId, []) { Name = page.Name ?? "Page" }).ToArray() };
                        break;
                    case ScreenRenamed screen:
                        if (!document.Screens.Any(s => s.Id == screen.ScreenId) || !ScreenNameValidator.IsValid(screen.Name)) throw new InvalidDataException("Invalid screen rename event.");
                        document = document with { Screens = document.Screens.Select(s => s.Id == screen.ScreenId ? s with { Name = screen.Name } : s).ToArray() };
                        break;
                    case ScreenResized screen:
                        if (!document.Screens.Any(s => s.Id == screen.ScreenId) || !ScreenDimensions.IsValid(screen.Dimensions)) throw new InvalidDataException("Invalid screen resize event.");
                        document = document with { Screens = document.Screens.Select(s => s.Id == screen.ScreenId ? s with { Dimensions = screen.Dimensions } : s).ToArray() };
                        break;
                    case ScreenAdded screen:
                        if (screen.Name is not null && !ScreenNameValidator.IsValid(screen.Name)) throw new InvalidDataException("Invalid screen name in creation event.");
                        if (!document.Pages.Any(p => p.Id == screen.PageId))
                            throw new InvalidDataException("Screen event references a missing page.");
                        document = DocumentStructureEditor.AddScreen(document, screen.PageId, screen.ScreenId, screen.Dimensions, screen.Name);
                        break;
                    case ScreenDuplicated duplicate:
                        document = duplicate.Patch.Apply(document)
                            ?? throw new InvalidDataException("Screen duplication preconditions failed during recovery.");
                        break;
                    case NodeAdded node:
                        if (node.Name is not null && !NodeMetadataValidator.IsValidName(node.Name)) throw new InvalidDataException("Invalid node name in creation event.");
                        if (!document.Screens.Any(s => s.Id == node.ParentId) && !document.Nodes.Any(n => n.Id == node.ParentId))
                            throw new InvalidDataException("Node event references a missing parent.");
                        document = DocumentStructureEditor.AddNode(document, node.ParentId, node.NodeId, node.Kind, node.Properties, node.Name);
                        if (node.Properties is not null) Validate(document);
                        break;
                    case NodeNameSet name:
                        if (!document.Nodes.Any(n => n.Id == name.NodeId) || !NodeMetadataValidator.IsValidName(name.Name))
                            throw new InvalidDataException("Invalid node name event.");
                        document = document with { Nodes = document.Nodes.Select(n => n.Id == name.NodeId ? n with { Name = name.Name } : n).ToArray() };
                        break;
                    case NodeSemanticKeySet key:
                        if (!document.Nodes.Any(n => n.Id == key.NodeId) || !NodeMetadataValidator.IsValidSemanticKey(key.SemanticKey))
                            throw new InvalidDataException("Invalid semantic key event.");
                        document = document with { Nodes = document.Nodes.Select(n => n.Id == key.NodeId ? n with { SemanticKey = key.SemanticKey } : n).ToArray() };
                        break;
                    case NodePropertySet property:
                        var target = document.Nodes.FirstOrDefault(n => n.Id == property.NodeId);
                        if (target is null || NodePropertyValidator.Validate(PortableUiProfileResolver.Require(document.Profile, profile),
                            target.Kind, property.Property, property.Value) is not null)
                            throw new InvalidDataException("Property event references a missing node or invalid property value.");
                        document = DocumentStructureEditor.SetNodeProperty(document, property.NodeId, property.Property, property.Value);
                        break;
                    case NodePropertiesSet properties:
                        if (!document.Nodes.Any(n => n.Id == properties.NodeId))
                            throw new InvalidDataException("Properties event references a missing node.");
                        document = DocumentStructureEditor.SetNodeProperties(document, properties.NodeId, properties.Properties);
                        Validate(document);
                        break;
                    case NodeMoved move:
                        if (!document.Nodes.Any(n => n.Id == move.NodeId) ||
                            (!document.Screens.Any(s => s.Id == move.TargetParentId) && !document.Nodes.Any(n => n.Id == move.TargetParentId)))
                            throw new InvalidDataException("Move event references a missing node or parent.");
                        document = DocumentStructureEditor.MoveNode(document, move.NodeId, move.TargetParentId, move.Position);
                        break;
                    case NodeDeleted deleted:
                        if (!document.Nodes.Any(n => n.Id == deleted.NodeId))
                            throw new InvalidDataException("Delete event references a missing node.");
                        document = DocumentStructureEditor.DeleteNode(document, deleted.NodeId);
                        break;
                    default:
                        throw new InvalidDataException("Invalid document event type or payload.");
                }
                revision++;
            }
            state = new(document, revision);
        }
        Validate(state.Document);
        ValidateStoredAssets(connection, transaction, state.Document);
        if (targetRevision is { } requestedRevision && state.Revision != requestedRevision)
            throw new InvalidDataException("The requested revision is not available in the journal.");
        return state;
    }

    private void Validate(DocumentStructure document)
    {
        ValidateProfile(document);
        if (document.Pages is null || document.Screens is null || document.Nodes is null ||
            document.Pages.Any(p => p is null || p.ScreenIds is null) ||
            document.Screens.Any(s => s is null || s.ChildIds is null) ||
            document.Nodes.Any(n => n is null || n.Kind is null || n.ChildIds is null) ||
            DocumentStructureValidator.Validate(document, profile).Count != 0)
            throw new InvalidDataException("Document structure is invalid.");
    }

    private void ValidateProfile(DocumentStructure document)
    {
        if (PortableUiProfileResolver.Validate(document.Profile, profile) is { } error)
            throw new PortableUiProfileException(error);
    }
}

