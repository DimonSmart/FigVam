namespace FigVam.Application.Documents;

public sealed record PresenceCursor(double X, double Y);
public sealed record PresenceUpdate(string Name, string Color, PresenceCursor? Cursor,
    IReadOnlyList<Guid> SelectedIds, Guid? ScreenId);
public sealed record PresenceParticipant(string ActorId, string Name, string Color, PresenceCursor? Cursor,
    IReadOnlyList<Guid> SelectedIds, Guid? ScreenId);
public sealed record PresenceResult(string Code, IReadOnlyList<PresenceParticipant>? Participants = null);

public interface IDocumentPresence
{
    Task<PresenceResult> UpdateAsync(Guid documentId, DocumentActor actor, PresenceUpdate update,
        CancellationToken cancellationToken = default);
    Task<PresenceResult> ReadAsync(Guid documentId, DocumentActor actor,
        CancellationToken cancellationToken = default);
}

// One instance holds ephemeral presence for the lifetime of the server process.
public sealed class DocumentPresence : IDocumentPresence
{
    private readonly IDocumentAuthorization authorization;
    private readonly TimeProvider timeProvider;
    private readonly TimeSpan timeToLive;
    private readonly Lock sync = new();
    private readonly Dictionary<Guid, Dictionary<string, Entry>> documents = [];
    private sealed record Entry(PresenceParticipant Participant, DateTimeOffset ExpiresAt);

    public DocumentPresence(IDocumentAuthorization authorization, TimeProvider timeProvider, TimeSpan timeToLive)
    {
        ArgumentNullException.ThrowIfNull(authorization);
        ArgumentNullException.ThrowIfNull(timeProvider);
        if (timeToLive <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeToLive));
        this.authorization = authorization;
        this.timeProvider = timeProvider;
        this.timeToLive = timeToLive;
    }

    public async Task<PresenceResult> UpdateAsync(Guid documentId, DocumentActor actor, PresenceUpdate update,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(update);
        var error = await CheckAccessAsync(documentId, actor, cancellationToken);
        if (error is not null) return error;
        if (string.IsNullOrWhiteSpace(update.Name) || update.Name.Length > 128 ||
            update.Color is null || !System.Text.RegularExpressions.Regex.IsMatch(update.Color, "^#[0-9a-fA-F]{6}$") ||
            update.SelectedIds is null || update.SelectedIds.Count > 100 || update.SelectedIds.Any(id => id == Guid.Empty) ||
            update.ScreenId == Guid.Empty ||
            update.Cursor is { } cursor && (!double.IsFinite(cursor.X) || !double.IsFinite(cursor.Y) ||
                Math.Abs(cursor.X) > 10000000 || Math.Abs(cursor.Y) > 10000000))
            return new("INVALID_PRESENCE");
        lock (sync)
        {
            var now = timeProvider.GetUtcNow();
            RemoveExpired(now);
            if (!documents.TryGetValue(documentId, out var participants))
                documents.Add(documentId, participants = []);
            participants[actor.Id] = new(new(actor.Id, update.Name, update.Color, update.Cursor,
                update.SelectedIds.ToArray(), update.ScreenId), now + timeToLive);
            return new("UPDATED");
        }
    }

    public async Task<PresenceResult> ReadAsync(Guid documentId, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        var error = await CheckAccessAsync(documentId, actor, cancellationToken);
        if (error is not null) return error;
        lock (sync)
        {
            RemoveExpired(timeProvider.GetUtcNow());
            var participants = documents.TryGetValue(documentId, out var entries)
                ? entries.Values.OrderBy(e => e.Participant.ActorId, StringComparer.Ordinal).Take(100)
                    .Select(e => e.Participant with { SelectedIds = e.Participant.SelectedIds.ToArray() }).ToArray()
                : [];
            return new("PRESENCE", participants);
        }
    }

    private async Task<PresenceResult?> CheckAccessAsync(Guid documentId, DocumentActor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        return documentId == Guid.Empty ? new("INVALID_ID") : null;
    }

    private void RemoveExpired(DateTimeOffset now)
    {
        foreach (var (documentId, participants) in documents.ToArray())
        {
            foreach (var (actorId, entry) in participants.ToArray())
                if (entry.ExpiresAt <= now) participants.Remove(actorId);
            if (participants.Count == 0) documents.Remove(documentId);
        }
    }
}
