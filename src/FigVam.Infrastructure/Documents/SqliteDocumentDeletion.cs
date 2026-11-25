using System.Text.Json;
using FigVam.Application.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Infrastructure.Documents;

public sealed partial class SqliteDocumentJournal : IDocumentDeletionJournal
{
    // A tombstone needs authorization and the durable revision, not a readable domain model.
    public Task<CommandResult> DeleteAsync(DeleteDocumentCommand request, DocumentActor actor,
        CancellationToken cancellationToken = default)
        => Task.Run(() =>
        {
            CommandResult Result(string code, long? revision = null) => new(request.DocumentId, request.CommandId,
                code, revision, actor.Id, null, DateTimeOffset.UtcNow,
                AffectedIds: code == "ACCEPTED" ? [request.DocumentId] : null);
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(actor.Id) || !File.Exists(Path.Combine(directory, $"{request.DocumentId:N}.sqlite")))
                return Result("FORBIDDEN");
            if (request.DocumentId == Guid.Empty || request.CommandId == Guid.Empty) return Result("INVALID_ID");
            if (request.ExpectedRevision < 0) return Result("INVALID_REVISION");
            using var connection = Open(request.DocumentId);
            using var transaction = connection.BeginTransaction(deferred: false);
            if (ReadRole(connection, transaction, actor.Id) != DocumentRole.Owner) return Result("FORBIDDEN");
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.Parameters.AddWithValue("$id", request.CommandId.ToString());
            command.CommandText = "SELECT result FROM results WHERE command_id=$id";
            if (command.ExecuteScalar() is string original)
                return JsonSerializer.Deserialize<CommandResult>(original)!;

            var revision = IsDeleted(connection, transaction) ? null : ReadCatalogRevision(connection, transaction);
            var result = revision is null ? Result("DOCUMENT_NOT_FOUND") :
                revision != request.ExpectedRevision ? Result("REVISION_CONFLICT") :
                Result("ACCEPTED", checked(revision.Value + 1));
            var serialized = JsonSerializer.Serialize(result);
            command.Parameters.AddWithValue("$result", serialized);
            if (result.Accepted)
            {
                command.Parameters.AddWithValue("$revision", result.Revision!.Value);
                command.Parameters.AddWithValue("$actor", actor.Id);
                command.Parameters.AddWithValue("$time", result.Timestamp.ToString("O"));
                command.Parameters.AddWithValue("$document", request.DocumentId.ToString());
                command.Parameters.AddWithValue("$payload", JsonSerializer.Serialize<DocumentEvent>(new DocumentDeleted()));
                command.CommandText = """
                    INSERT INTO events(revision,command_id,actor_id,timestamp,type,subject_id)
                    VALUES($revision,$id,$actor,$time,'DELETE_DOCUMENT',$document);
                    INSERT INTO payload_events(revision,payload) VALUES($revision,$payload);
                    INSERT INTO command_history(command_id,actor_id,result,type,patch,status,history_order)
                    VALUES($id,$actor,$result,'DELETE_DOCUMENT',NULL,'RECORDED',$revision);
                    INSERT INTO document_deletion(singleton,revision) VALUES(1,$revision);
                    UPDATE document_metadata SET revision=$revision,updated_utc=$time WHERE singleton=1;
                    """;
                command.ExecuteNonQuery();
            }
            command.CommandText = "INSERT INTO results(command_id,result) VALUES($id,$result)";
            command.ExecuteNonQuery();
            cancellationToken.ThrowIfCancellationRequested();
            transaction.Commit();
            return result;
        }, cancellationToken);
}
