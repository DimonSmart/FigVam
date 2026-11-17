using System.Diagnostics.Metrics;

namespace FigVam.Server.Documents;

// Fixed permits bound active work; a subscription never buffers a producer queue.
public sealed class DocumentSubscriptionLimits
{
    private static readonly Meter Meter = new("FigVam.DocumentSubscriptions");
    private static readonly UpDownCounter<long> Connections = Meter.CreateUpDownCounter<long>("figvam.document.subscription.connections");
    private readonly object gate = new();
    private readonly Dictionary<string, int> actors = [];
    private int count;

    public IDisposable? TryAcquire(string actor)
    {
        lock (gate)
        {
            var current = actors.GetValueOrDefault(actor);
            if (count >= 128 || current >= 5) return null;
            count++;
            actors[actor] = current + 1;
            Connections.Add(1);
            return new Lease(this, actor);
        }
    }

    private sealed class Lease(DocumentSubscriptionLimits owner, string actor) : IDisposable
    {
        private int disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            lock (owner.gate)
            {
                owner.count--;
                Connections.Add(-1);
                if (--owner.actors[actor] == 0) owner.actors.Remove(actor);
            }
        }
    }
}


