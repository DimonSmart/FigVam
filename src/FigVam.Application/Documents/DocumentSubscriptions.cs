using System.Runtime.CompilerServices;
using System.Diagnostics.Metrics;

namespace FigVam.Application.Documents;

public sealed record DocumentSubscriptionMessage(string Code, long Revision, CommittedDocumentEvent? Change = null);

public interface IDocumentSubscriptions
{
    IAsyncEnumerable<DocumentSubscriptionMessage> ReadAsync(Guid documentId, long lastSeenRevision,
        DocumentActor actor, CancellationToken cancellationToken = default);
}

// The journal cursor is also the subscription cursor: no process-local publish/subscribe boundary exists.
public sealed class DocumentSubscriptions(IDocumentReconnectReader reader, IDocumentAuthorization authorization)
    : IDocumentSubscriptions
{
    private static readonly Meter Meter = new("FigVam.DocumentSubscriptions");
    private static readonly Histogram<long> Lag = Meter.CreateHistogram<long>("figvam.document.subscription.lag", "revisions");
    public async IAsyncEnumerable<DocumentSubscriptionMessage> ReadAsync(Guid documentId, long lastSeenRevision,
        DocumentActor actor,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var result = await reader.ReadAsync(documentId, lastSeenRevision, actor, cancellationToken);
        var heartbeat = Environment.TickCount64;
        yield return new("READY", lastSeenRevision);
        while (true)
        {
            if (result.Revision is { } current) Lag.Record(current - lastSeenRevision);
            if (result.Code == "FORBIDDEN")
            {
                yield return new("FORBIDDEN", lastSeenRevision);
                yield break;
            }
            if (result.Code != "EVENTS")
            {
                yield return new("RECONNECT_REQUIRED", lastSeenRevision);
                yield break;
            }
            foreach (var change in result.Events!)
            {
                // A batch may wait on a slow transport. Recheck membership immediately before each delivery.
                if (!await authorization.CanReadAsync(actor, documentId, cancellationToken))
                {
                    yield return new("FORBIDDEN", lastSeenRevision);
                    yield break;
                }
                if (change.Revision != lastSeenRevision + 1)
                {
                    yield return new("RECONNECT_REQUIRED", lastSeenRevision);
                    yield break;
                }
                yield return new("CHANGE", change.Revision, change);
                lastSeenRevision = change.Revision;
            }
            if (Environment.TickCount64 - heartbeat >= 10_000)
            {
                yield return new("HEARTBEAT", lastSeenRevision);
                heartbeat = Environment.TickCount64;
            }
            await Task.Delay(TimeSpan.FromMilliseconds(100), cancellationToken);
            result = await reader.ReadAsync(documentId, lastSeenRevision, actor, cancellationToken);
        }
    }
}
