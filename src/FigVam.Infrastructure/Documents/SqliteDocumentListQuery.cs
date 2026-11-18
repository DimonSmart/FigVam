using FigVam.Application.Documents;

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
                using var connection = Open(id);
                using var transaction = connection.BeginTransaction(deferred: true);
                var role = ReadRole(connection, transaction, actor.Id);
                if (role is null) continue;
                var state = Recover(connection, transaction, id);
                if (state is null) continue;
                if (items.Count == limit) return new DocumentListResponse(items, items[^1].DocumentId);
                items.Add(new(id, state.Document.Name, role.Value.ToString()));
            }
            return new DocumentListResponse(items, null);
        }, cancellationToken);
    }
}
