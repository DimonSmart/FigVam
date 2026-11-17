using System.Security.Claims;
using FigVam.Application.Documents;
using FigVam.Server.Documents;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Tests;

public sealed class DocumentSubscriptionFlowTests
{
    [Fact]
    public async Task RevocationBetweenBufferedEventsStopsTheNextDelivery()
    {
        var id = Guid.NewGuid();
        var reader = new Reader { Result = new("EVENTS", 2, [
            new(id, 1, Guid.NewGuid(), "owner", "ADD_PAGE", new PageAdded(Guid.NewGuid())),
            new(id, 2, Guid.NewGuid(), "owner", "ADD_PAGE", new PageAdded(Guid.NewGuid()))]) };
        var authorization = new Authorization();
        var subscriptions = new DocumentSubscriptions(reader, authorization);
        await using var iterator = subscriptions.ReadAsync(id, 0, new("viewer")).GetAsyncEnumerator();
        Assert.True(await iterator.MoveNextAsync());
        Assert.Equal("READY", iterator.Current.Code);
        Assert.True(await iterator.MoveNextAsync());
        Assert.Equal("CHANGE", iterator.Current.Code);
        authorization.Allowed = false;
        Assert.True(await iterator.MoveNextAsync());
        Assert.Equal("FORBIDDEN", iterator.Current.Code);
        Assert.Equal(1, iterator.Current.Revision);
        Assert.Null(iterator.Current.Change);
        Assert.False(await iterator.MoveNextAsync());
    }

    [Fact]
    public async Task SubscriberThatStopsConsumingRecoversInsteadOfSkippingJournalGap()
    {
        var reader = new Reader { Result = new("EVENTS", 0, []) };
        var subscriptions = new DocumentSubscriptions(reader, new Authorization());
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        await using var iterator = subscriptions.ReadAsync(Guid.NewGuid(), 0, new("viewer"), cancellation.Token).GetAsyncEnumerator();
        Assert.True(await iterator.MoveNextAsync());
        Assert.Equal("READY", iterator.Current.Code);
        reader.Result = new("SNAPSHOT", 101);
        Assert.True(await iterator.MoveNextAsync());
        Assert.Equal("RECONNECT_REQUIRED", iterator.Current.Code);
        Assert.Equal(0, iterator.Current.Revision);
        Assert.False(await iterator.MoveNextAsync());
    }

    [Fact]
    public async Task SlowTransportWriteIsCanceledAndItsPermitReleased()
    {
        var reader = new Reader { Result = new("EVENTS", 0, []) };
        var limits = new DocumentSubscriptionLimits();
        using var one = limits.TryAcquire("viewer");
        using var two = limits.TryAcquire("viewer");
        using var three = limits.TryAcquire("viewer");
        using var four = limits.TryAcquire("viewer");
        var controller = new DocumentSubscriptionController(reader, new DocumentSubscriptions(reader, new Authorization()), limits);
        var context = new DefaultHttpContext();
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "viewer")], "test"));
        context.Request.QueryString = new("?lastSeenRevision=0");
        using var body = new BlockedStream();
        context.Response.Body = body;
        controller.ControllerContext = new ControllerContext { HttpContext = context };
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var action = controller.Read(Guid.NewGuid(), 0, deadline.Token);
        await body.Started.Task.WaitAsync(deadline.Token);
        Assert.Null(limits.TryAcquire("viewer"));
        await action.WaitAsync(deadline.Token);
        Assert.False(deadline.IsCancellationRequested);
        Assert.True(body.Canceled);
        using var released = limits.TryAcquire("viewer");
        Assert.NotNull(released);
    }

    private sealed class Reader : IDocumentReconnectReader
    {
        public required DocumentReconnectResult Result { get; set; }
        public Task<DocumentReconnectResult> ReadAsync(Guid documentId, long lastSeenRevision, DocumentActor actor, CancellationToken cancellationToken = default)
            => Task.FromResult(Result);
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public bool Allowed { get; set; } = true;
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken) => ValueTask.FromResult(Allowed);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken) => ValueTask.FromResult(false);
    }
    private sealed class BlockedStream : MemoryStream
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Canceled { get; private set; }
        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
            catch (OperationCanceledException) { Canceled = true; throw; }
        }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
    }
}
