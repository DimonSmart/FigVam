using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal : IDocumentAuthorization, IDocumentAccessService
{
    public Task<DocumentAccessResult> CreateAsync(CreateDocumentCommand request, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);
        return Task.Run(() =>
        {
            if (string.IsNullOrWhiteSpace(actor.Id)) return new DocumentAccessResult("FORBIDDEN", Guid.Empty);
            var id = request.DocumentId;
            if (id == Guid.Empty) return new DocumentAccessResult("INVALID_ID", id);
            using var connection = Open(id);
            using var transaction = connection.BeginTransaction(deferred: false);
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT EXISTS(SELECT 1 FROM snapshots)";
            if ((long)command.ExecuteScalar()! != 0) return new DocumentAccessResult("DOCUMENT_EXISTS", id);
            command.CommandText = "INSERT INTO snapshots(revision,document) VALUES(0,$document); INSERT INTO members(actor_id,role) VALUES($actor,'Owner');";
            command.Parameters.AddWithValue("$document", JsonSerializer.Serialize(new DocumentStructure(id, [], [], [])));
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

    private Task<DocumentRole?> ReadRoleAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return Task.Run(() =>
        {
            if (documentId == Guid.Empty || string.IsNullOrWhiteSpace(actor.Id) ||
                !File.Exists(Path.Combine(directory, $"{documentId:N}.sqlite"))) return null;
            using var connection = Open(documentId);
            return ReadRole(connection, null, actor.Id);
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
            if (ReadRole(connection, transaction, actor.Id) != DocumentRole.Owner) return Result("FORBIDDEN");
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
