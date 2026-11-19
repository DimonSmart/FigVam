using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal : IDocumentAuthorization, IDocumentAccessService, IDocumentImportStore
{
    public Task<DocumentAccessResult> CreateAsync(CreateDocumentCommand request, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!DocumentNameValidator.IsValid(request.Name)) return Task.FromResult(new DocumentAccessResult("INVALID_DOCUMENT_NAME", request.DocumentId));
        return CreateOwnedAsync(new DocumentStructure(request.DocumentId, [], [], []) { Profile = profile.Identity, Name = request.Name }, [], actor, cancellationToken);
    }

    public Task<DocumentAccessResult> CreateImportedAsync(DocumentStructure document, IReadOnlyList<DocumentAssetContent> assets, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(assets);
        return CreateOwnedAsync(document, assets, actor, cancellationToken);
    }

    private Task<DocumentAccessResult> CreateOwnedAsync(DocumentStructure document, IReadOnlyList<DocumentAssetContent> assets, DocumentActor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        // Freeze content before asynchronous persistence, and verify the entire manifest.
        var importedAssets = assets.Select(a => new DocumentAssetContent(a.Asset, a.Content.ToArray())).ToArray();
        return Task.Run(() =>
        {
            if (string.IsNullOrWhiteSpace(actor.Id)) return new DocumentAccessResult("FORBIDDEN", Guid.Empty);
            var id = document.Id;
            if (id == Guid.Empty) return new DocumentAccessResult("INVALID_ID", id);
            Validate(document);
            if (importedAssets.Length != document.Assets.Count || importedAssets.Select(a => a.Asset.Id).Distinct().Count() != importedAssets.Length ||
                importedAssets.Any(a => !document.Assets.Contains(a.Asset) || SafeRasterImage.Inspect(a.Asset.Id, a.Asset.ContentType, a.Content) != a.Asset))
                return new DocumentAccessResult("INVALID_ASSET", id);
            using var connection = Open(id);
            using var transaction = connection.BeginTransaction(deferred: false);
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT EXISTS(SELECT 1 FROM snapshots)";
            if ((long)command.ExecuteScalar()! != 0) return new DocumentAccessResult("DOCUMENT_EXISTS", id);
            foreach (var asset in importedAssets)
            {
                using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO asset_content(sha256,content) VALUES($hash,$content) ON CONFLICT(sha256) DO NOTHING";
                insert.Parameters.AddWithValue("$hash", asset.Asset.Sha256);
                insert.Parameters.AddWithValue("$content", asset.Content);
                insert.ExecuteNonQuery();
            }
            ValidateStoredAssets(connection, transaction, document);
            command.CommandText = "INSERT INTO snapshots(revision,document) VALUES(0,$document); INSERT INTO members(actor_id,role) VALUES($actor,'Owner');";
            command.Parameters.AddWithValue("$document", JsonSerializer.Serialize(document));
            command.Parameters.AddWithValue("$actor", actor.Id);
            command.ExecuteNonQuery();
            cancellationToken.ThrowIfCancellationRequested();
            transaction.Commit();
            return new DocumentAccessResult("ACCEPTED", id);
        }, cancellationToken);
    }

    public async ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
        => await ReadRoleAsync(actor, documentId, cancellationToken) is not null;

    public async ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
        => await ReadRoleAsync(actor, documentId, cancellationToken) is DocumentRole.Owner or DocumentRole.Editor;

    public async ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
        => await ReadRoleAsync(actor, documentId, cancellationToken, includeDeleted: true) is DocumentRole.Owner;

    private Task<DocumentRole?> ReadRoleAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken, bool includeDeleted = false)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return Task.Run(() =>
        {
            if (documentId == Guid.Empty || string.IsNullOrWhiteSpace(actor.Id) ||
                !File.Exists(Path.Combine(directory, $"{documentId:N}.sqlite"))) return null;
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: true);
            if (!includeDeleted && IsDeleted(connection, transaction)) return null;
            return ReadRole(connection, transaction, actor.Id);
        }, cancellationToken);
    }

    private static DocumentRole? ReadRole(SqliteConnection connection, SqliteTransaction? transaction, string actorId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT role FROM members WHERE actor_id=$actor";
        command.Parameters.AddWithValue("$actor", actorId);
        return command.ExecuteScalar() is string role ? Enum.Parse<DocumentRole>(role) : null;
    }

    public Task<DocumentAccessResult> SetMemberAsync(Guid documentId, string memberId, DocumentRole role,
        DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeMemberAsync(documentId, memberId, role, actor, cancellationToken);

    public Task<DocumentAccessResult> RemoveMemberAsync(Guid documentId, string memberId,
        DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeMemberAsync(documentId, memberId, null, actor, cancellationToken);

    private Task<DocumentAccessResult> ChangeMemberAsync(Guid documentId, string memberId, DocumentRole? role,
        DocumentActor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return Task.Run(() =>
        {
            DocumentAccessResult Result(string code) => new(code, documentId);
            if (documentId == Guid.Empty || string.IsNullOrWhiteSpace(actor.Id) ||
                !File.Exists(Path.Combine(directory, $"{documentId:N}.sqlite"))) return Result("FORBIDDEN");
            using var connection = Open(documentId);
            using var transaction = connection.BeginTransaction(deferred: false);
            if (IsDeleted(connection, transaction) || ReadRole(connection, transaction, actor.Id) != DocumentRole.Owner) return Result("FORBIDDEN");
            if (string.IsNullOrWhiteSpace(memberId)) return Result("INVALID_MEMBER");
            if (role is { } value && !Enum.IsDefined(value)) return Result("INVALID_ROLE");
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            if (role != DocumentRole.Owner && ReadRole(connection, transaction, memberId) == DocumentRole.Owner)
            {
                command.CommandText = "SELECT COUNT(*) FROM members WHERE role='Owner'";
                if ((long)command.ExecuteScalar()! == 1) return Result("LAST_OWNER");
            }
            command.CommandText = role is null ? "DELETE FROM members WHERE actor_id=$member"
                : "INSERT INTO members(actor_id,role) VALUES($member,$role) ON CONFLICT(actor_id) DO UPDATE SET role=excluded.role";
            command.Parameters.AddWithValue("$member", memberId);
            if (role is not null) command.Parameters.AddWithValue("$role", role.ToString()!);
            command.ExecuteNonQuery();
            cancellationToken.ThrowIfCancellationRequested();
            transaction.Commit();
            return Result("ACCEPTED");
        }, cancellationToken);
    }
}
