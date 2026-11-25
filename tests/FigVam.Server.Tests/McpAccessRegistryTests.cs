using FigVam.Server.Mcp;

namespace FigVam.Server.Tests;

public sealed class McpAccessRegistryTests
{
    [Fact]
    public void TokensAreScopedUniqueAndNotPersistent()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid();
        var first = registry.Grant(doc, "alice");
        Assert.Same(first, registry.Grant(doc, "alice"));
        Assert.Same(first, registry.Resolve(first.Token));
        Assert.Equal(doc, first.DocumentId);
        Assert.Equal("alice", first.UserId);
        Assert.StartsWith("fvm_", first.Token);
        Assert.Equal(47, first.Token.Length);
        Assert.NotEqual(first.Token, registry.Grant(doc, "bob").Token);
        Assert.NotEqual(first.Token, registry.Grant(Guid.NewGuid(), "alice").Token);
        Assert.Null(registry.Resolve("fvm_invalid"));
        Assert.Null(new McpAccessRegistry().Resolve(first.Token));
    }

    [Fact]
    public async Task ConcurrentGrantsReturnSameSecret()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid();
        var results = await Task.WhenAll(Enumerable.Range(0, 64)
            .Select(_ => Task.Run(() => registry.Grant(doc, "alice"))));
        Assert.Single(results.Select(x => x.Token).Distinct());
    }

    [Fact]
    public async Task RevocationWaitsForAdmittedOperationAndInvalidatesOldContext()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid();
        var grant = registry.Grant(doc, "alice");
        var other = registry.Grant(doc, "bob");
        using var lease = await registry.EnterAsync(grant, CancellationToken.None);
        Assert.NotNull(lease);
        var revocation = registry.RevokeAsync(doc, "alice", CancellationToken.None);
        Assert.False(revocation.IsCompleted);
        lease!.Dispose();
        await revocation;
        Assert.Null(registry.Resolve(grant.Token));
        Assert.Null(await registry.EnterAsync(grant, CancellationToken.None));
        Assert.Same(other, registry.Resolve(other.Token));
        var replacement = registry.Grant(doc, "alice");
        Assert.NotEqual(grant.Token, replacement.Token);
        await registry.RevokeAsync(grant, CancellationToken.None);
        Assert.Same(replacement, registry.Resolve(replacement.Token));
    }

    [Fact]
    public async Task TunnelGrantIsExclusiveAndRevocationWaitsForItsOwnLease()
    {
        var registry = new McpAccessRegistry();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var direct = registry.Grant(a, "alice");
        var selected = registry.GrantTunnel(a, "alice")!;
        Assert.Same(selected, registry.GrantTunnel(a, "alice"));
        Assert.Null(registry.GrantTunnel(b, "alice"));
        Assert.Null(registry.GrantTunnel(a, "bob"));
        Assert.Null(registry.Resolve(selected.Token));
        Assert.Null(new McpAccessRegistry().GetTunnelGrant());

        await registry.RevokeTunnelAsync(a, "bob", CancellationToken.None);
        Assert.Same(selected, registry.GetTunnelGrant());
        using var lease = await registry.EnterAsync(selected, CancellationToken.None);
        Assert.NotNull(lease);
        var revoke = registry.RevokeTunnelAsync(a, "alice", CancellationToken.None);
        Assert.False(revoke.IsCompleted);
        Assert.Null(registry.GrantTunnel(b, "alice"));
        lease!.Dispose();
        await revoke;
        Assert.Null(await registry.EnterAsync(selected, CancellationToken.None));
        Assert.Same(direct, registry.Resolve(direct.Token));
        var replacement = registry.GrantTunnel(b, "bob")!;
        await registry.RevokeAsync(selected, CancellationToken.None);
        Assert.Same(replacement, registry.GetTunnelGrant());
        await registry.RevokeUserAsync("bob", CancellationToken.None);
        Assert.Null(registry.GetTunnelGrant());
    }

    [Fact]
    public async Task TunnelAndDirectRevocationAreIndependentExceptOnRightsLoss()
    {
        var registry = new McpAccessRegistry();
        var doc = Guid.NewGuid();
        var direct = registry.Grant(doc, "alice");
        var tunnel = registry.GrantTunnel(doc, "alice");
        await registry.RevokeDirectAsync(doc, "alice", CancellationToken.None);
        Assert.Null(registry.Resolve(direct.Token));
        Assert.Same(tunnel, registry.GetTunnelGrant());
        direct = registry.Grant(doc, "alice");
        await registry.RevokeAsync(doc, "alice", CancellationToken.None);
        Assert.Null(registry.Resolve(direct.Token));
        Assert.Null(registry.GetTunnelGrant());
        registry.GrantTunnel(doc, "alice");
        await registry.RevokeDocumentAsync(doc, CancellationToken.None);
        Assert.Null(registry.GetTunnelGrant());
    }

    [Fact]
    public async Task ConcurrentTunnelSelectionsNeverBindTwoDocuments()
    {
        var registry = new McpAccessRegistry();
        var results = await Task.WhenAll(Enumerable.Range(0, 64)
            .Select(_ => Task.Run(() => registry.GrantTunnel(Guid.NewGuid(), "alice"))));
        Assert.Single(results.OfType<McpDocumentGrant>());
        Assert.Same(results.Single(g => g is not null), registry.GetTunnelGrant());
    }
}
