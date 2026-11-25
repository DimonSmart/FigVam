using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace FigVam.Server.Mcp;

// Secrets exist exclusively in this process. Never serialize or log a grant.
public sealed class McpDocumentGrant
{
    internal McpDocumentGrant(Guid documentId, string userId)
    {
        DocumentId = documentId;
        UserId = userId;
        Token = "fvm_" + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid DocumentId { get; }
    public string UserId { get; }
    public string Token { get; }
    public DateTimeOffset CreatedAt { get; }
    internal SemaphoreSlim Gate { get; } = new(1, 1);
}

public sealed class McpAccessRegistry
{
    private readonly object sync = new();
    private readonly Dictionary<(Guid, string), McpDocumentGrant> grants = new();
    private readonly Dictionary<string, McpDocumentGrant> tokens = new(StringComparer.Ordinal);

    private static string Fingerprint(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public McpDocumentGrant Grant(Guid documentId, string userId)
    {
        lock (sync)
        {
            if (grants.TryGetValue((documentId, userId), out var existing))
                return existing;
            var grant = new McpDocumentGrant(documentId, userId);
            tokens.Add(Fingerprint(grant.Token), grant);
            grants.Add((documentId, userId), grant);
            return grant;
        }
    }

    public McpDocumentGrant? GetStatus(Guid documentId, string userId)
    {
        lock (sync) return grants.GetValueOrDefault((documentId, userId));
    }

    public McpDocumentGrant? Resolve(string token)
    {
        if (token.Length != 47 || !token.StartsWith("fvm_", StringComparison.Ordinal)) return null;
        lock (sync) return tokens.GetValueOrDefault(Fingerprint(token));
    }

    // Hold the lease until the domain operation has completed, including its durable commit.
    // Revocation waits for an admitted operation and prevents queued operations from starting.
    public async Task<IDisposable?> EnterAsync(McpDocumentGrant grant, CancellationToken ct)
    {
        await grant.Gate.WaitAsync(ct);
        lock (sync)
        {
            if (ReferenceEquals(grants.GetValueOrDefault((grant.DocumentId, grant.UserId)), grant))
                return new Lease(grant.Gate);
        }
        grant.Gate.Release();
        return null;
    }

    public async Task RevokeAsync(Guid documentId, string userId, CancellationToken ct)
    {
        var grant = GetStatus(documentId, userId);
        if (grant is not null) await RevokeAsync(grant, ct);
    }

    public async Task RevokeAsync(McpDocumentGrant grant, CancellationToken ct)
    {
        using var lease = await EnterAsync(grant, ct);
        if (lease is null) return;
        Remove(grant);
    }

    // Only call while holding this grant's operation lease.
    internal void Remove(McpDocumentGrant grant)
    {
        lock (sync)
        {
            if (!ReferenceEquals(grants.GetValueOrDefault((grant.DocumentId, grant.UserId)), grant))
                return;
            grants.Remove((grant.DocumentId, grant.UserId));
            tokens.Remove(Fingerprint(grant.Token));
        }
    }

    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private SemaphoreSlim? held = gate;
        public void Dispose() => Interlocked.Exchange(ref held, null)?.Release();
    }
}
