using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentPresenceTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Rights : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public HashSet<(string, Guid)> Allowed { get; } = [];
        public int Checks { get; private set; }
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
        {
            Checks++;
            return ValueTask.FromResult(Allowed.Contains((actor.Id, documentId)));
        }
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken)
            => ValueTask.FromResult(false);
    }
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => false;
        public bool CanContainChildren(string kind) => false;
    }
    private static PresenceUpdate Update(string name, IReadOnlyList<Guid>? selected = null) =>
        new(name, "#123456", new(10, 20), selected ?? [], Guid.NewGuid());

    [Fact]
    public async Task ParticipantsAreIsolatedAndAccessIsCheckedOnEveryOperation()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        var alice = new DocumentActor("alice"); var bob = new DocumentActor("bob");
        var rights = new Rights();
        rights.Allowed.UnionWith([(alice.Id, a), (bob.Id, a), (bob.Id, b)]);
        var service = new DocumentPresence(rights, new Clock(), TimeSpan.FromMinutes(1));
        var selected = new[] { Guid.NewGuid() };
        var aliceUpdate = Update("Alice", selected);
        await service.UpdateAsync(a, alice, aliceUpdate);
        selected[0] = Guid.NewGuid();
        await service.UpdateAsync(a, bob, Update("Bob"));
        await service.UpdateAsync(b, bob, Update("Other"));
        var list = (await service.ReadAsync(a, alice)).Participants!;
        Assert.Equal(2, list.Count);
        Assert.Equal(aliceUpdate.ScreenId, list.Single(p => p.ActorId == alice.Id).ScreenId);
        Assert.NotEqual(selected[0], list.Single(p => p.ActorId == alice.Id).SelectedIds[0]);
        Assert.Equal("FORBIDDEN", (await service.ReadAsync(b, alice)).Code);
        Assert.Equal("FORBIDDEN", (await service.UpdateAsync(b, alice, Update("Intruder"))).Code);
        rights.Allowed.Remove((alice.Id, a));
        Assert.Equal("FORBIDDEN", (await service.ReadAsync(a, alice)).Code);
        Assert.Equal("FORBIDDEN", (await service.UpdateAsync(a, alice, Update("Revoked"))).Code);
        Assert.Single((await service.ReadAsync(b, bob)).Participants!);
        Assert.Equal(9, rights.Checks);
    }

    [Fact]
    public async Task UpdatesRefreshOnlyOwnExpiryAndExpiredParticipantsDisappear()
    {
        var document = Guid.NewGuid(); var alice = new DocumentActor("alice"); var bob = new DocumentActor("bob");
        var rights = new Rights(); rights.Allowed.UnionWith([(alice.Id, document), (bob.Id, document)]);
        var clock = new Clock(); var service = new DocumentPresence(rights, clock, TimeSpan.FromSeconds(10));
        await service.UpdateAsync(document, alice, Update("Alice"));
        await service.UpdateAsync(document, bob, Update("Bob"));
        clock.Now += TimeSpan.FromSeconds(9);
        await service.UpdateAsync(document, alice, Update("Alice updated"));
        clock.Now += TimeSpan.FromSeconds(1);
        var remaining = (await service.ReadAsync(document, alice)).Participants!;
        Assert.Equal("Alice updated", Assert.Single(remaining).Name);
        clock.Now += TimeSpan.FromSeconds(9);
        Assert.Empty((await service.ReadAsync(document, alice)).Participants!);
    }

    [Fact]
    public async Task PresenceDoesNotChangeRevisionOrJournal()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-presence-" + Guid.NewGuid());
        try
        {
            var document = Guid.NewGuid(); var actor = new DocumentActor("alice");
            var journal = new SqliteDocumentJournal(directory, new Profile());
            await journal.InitializeAsync(new(document, [], [], []));
            var rights = new Rights(); rights.Allowed.Add((actor.Id, document));
            var service = new DocumentPresence(rights, new Clock(), TimeSpan.FromMinutes(1));
            var before = await journal.ReadEventsAsync(document, 0);
            await service.UpdateAsync(document, actor, Update("Alice"));
            await service.ReadAsync(document, actor);
            var after = await journal.ReadEventsAsync(document, 0);
            Assert.Equal(before.Revision, after.Revision);
            Assert.Equal(before.Events, after.Events);
            Assert.Equal(0, (await journal.ReadAsync(document))!.Revision);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
