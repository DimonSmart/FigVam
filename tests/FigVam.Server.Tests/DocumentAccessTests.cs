using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class DocumentAccessTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-access-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("authenticated-owner");
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => false;
        public bool CanContainChildren(string kind) => false;
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());

    [Fact]
    public async Task CreationNameAndSavedVersionRemainDurable()
    {
        var store = Journal(); var id = Guid.NewGuid();
        Assert.Equal("INVALID_DOCUMENT_NAME", (await store.CreateAsync(new(id, " "), owner)).Code);
        Assert.True((await store.CreateAsync(new(id, "Initial"), owner)).Accepted);
        var handler = new DocumentCommandHandler(store, store, new Profile());
        Assert.True((await handler.HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Renamed"), owner)).Accepted);
        var saved = await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid(), "Milestone"), owner);
        Assert.True(saved.Accepted);
        Assert.True((await handler.HandleAsync(new RenameDocumentCommand(id, Guid.NewGuid(), "Later"), owner)).Accepted);
        store = Journal();
        Assert.Equal("Initial", (await store.ReadAsync(id, 0)).State!.Document.Name);
        Assert.Equal("Renamed", (await store.ReadVersionAsync(id, saved.VersionId!.Value)).Version!.Snapshot.Document.Name);
        Assert.Equal("Later", (await store.ReadAsync(id))!.Document.Name);
    }

    [Fact]
    public async Task CreationAndRolesSurviveRestartAndDocumentsRemainIsolated()
    {
        var store = Journal();
        var first = await store.CreateAsync(new(Guid.NewGuid()), owner);
        var second = await store.CreateAsync(new(Guid.NewGuid()), new("other-owner"));
        Assert.True(first.Accepted);
        Assert.NotEqual(first.DocumentId, second.DocumentId);
        Assert.True((await store.SetMemberAsync(first.DocumentId, "editor", DocumentRole.Editor, owner)).Accepted);
        Assert.True((await store.SetMemberAsync(first.DocumentId, "viewer", DocumentRole.Viewer, owner)).Accepted);
        store = Journal();
        var state = await store.ReadAsync(first.DocumentId);
        Assert.Equal(0, state!.Revision);
        Assert.Empty(state.Document.Pages);
        Assert.Empty(state.Document.Screens);
        Assert.Empty(state.Document.Nodes);
        foreach (var id in new[] { owner.Id, "editor", "viewer" })
        {
            Assert.True(await store.CanReadAsync(new(id), first.DocumentId, default));
            Assert.Equal(id != "viewer", await store.CanEditAsync(new(id), first.DocumentId, default));
            Assert.False(await store.CanReadAsync(new(id), second.DocumentId, default));
            Assert.False(await store.CanEditAsync(new(id), second.DocumentId, default));
        }
        Assert.False(await store.CanReadAsync(new("outsider"), first.DocumentId, default));
        Assert.False(await store.CanReadAsync(owner, Guid.NewGuid(), default));
        Assert.False((await store.CreateAsync(new(Guid.NewGuid()), new(" "))).Accepted);
        var handler = new DocumentCommandHandler(store, store, new Profile());
        var add = new AddPageCommand(first.DocumentId, Guid.NewGuid(), Guid.NewGuid());
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(add, new("viewer"))).Code);
        Assert.Equal(0, (await store.ReadAsync(first.DocumentId))!.Revision);
        Assert.True((await handler.HandleAsync(add, new("editor"))).Accepted);
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(add, new("viewer"))).Code);
        Assert.True((await handler.HandleAsync(add with { CommandId = Guid.NewGuid(), PageId = Guid.NewGuid() }, owner)).Accepted);
        Assert.Equal(2, (await Journal().ReadAsync(first.DocumentId))!.Revision);
    }

    [Fact]
    public async Task OnlyOwnersManageMembersAndLastOwnerCannotBeRemovedOrDemoted()
    {
        var store = Journal();
        var id = (await store.CreateAsync(new(Guid.NewGuid()), owner)).DocumentId;
        foreach (var role in new[] { DocumentRole.Editor, DocumentRole.Viewer })
        {
            await store.SetMemberAsync(id, "member", role, owner);
            Assert.Equal("FORBIDDEN", (await store.SetMemberAsync(id, "attacker", DocumentRole.Owner, new("member"))).Code);
            Assert.Equal("FORBIDDEN", (await store.RemoveMemberAsync(id, owner.Id, new("member"))).Code);
        }
        Assert.Equal("FORBIDDEN", (await store.SetMemberAsync(id, "outsider", DocumentRole.Owner, new("outsider"))).Code);
        Assert.Equal("LAST_OWNER", (await store.RemoveMemberAsync(id, owner.Id, owner)).Code);
        Assert.Equal("LAST_OWNER", (await store.SetMemberAsync(id, owner.Id, DocumentRole.Editor, owner)).Code);
        await store.SetMemberAsync(id, "second-owner", DocumentRole.Owner, owner);
        var results = await Task.WhenAll(
            Journal().RemoveMemberAsync(id, owner.Id, owner),
            Journal().RemoveMemberAsync(id, "second-owner", new("second-owner")));
        Assert.Single(results, r => r.Accepted);
        Assert.Single(results, r => r.Code == "LAST_OWNER");
        Assert.Equal(0, (await Journal().ReadAsync(id))!.Revision);
    }

    [Fact]
    public async Task RevocationDuringCommandAdmissionIsRecheckedBeforeDeduplicationOrCommit()
    {
        var store = Journal();
        var id = (await store.CreateAsync(new(Guid.NewGuid()), owner)).DocumentId;
        await store.SetMemberAsync(id, "editor", DocumentRole.Editor, owner);
        var authorization = new RevokeOnFirstCheck(store, owner);
        var handler = new DocumentCommandHandler(authorization, store, new Profile());
        Assert.Equal("FORBIDDEN", (await handler.HandleAsync(new AddPageCommand(id, Guid.NewGuid(), Guid.NewGuid()), new("editor"))).Code);
        Assert.Equal(0, (await store.ReadAsync(id))!.Revision);
    }

    private sealed class RevokeOnFirstCheck(SqliteDocumentJournal store, DocumentActor owner) : IDocumentAuthorization
    {
        private int checks;
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken token)
            => store.CanReadAsync(actor, id, token);
        public async ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken token)
        {
            var allowed = await store.CanEditAsync(actor, id, token);
            if (Interlocked.Increment(ref checks) == 1) await store.RemoveMemberAsync(id, actor.Id, owner, token);
            return allowed;
        }
    }

    [Fact]
    public async Task CreationRollsBackSnapshotWhenOwnerInsertFailsAndCannotReplaceExistingOwner()
    {
        var store = Journal();
        var id = Guid.NewGuid();
        // Open the schema without a document, then inject a database failure between both writes.
        Assert.Null(await store.ReadAsync(id));
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TRIGGER fail_creation BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT,'test failure'); END";
            command.ExecuteNonQuery();
        }
        await Assert.ThrowsAsync<SqliteException>(() => store.CreateAsync(new(id), owner));
        Assert.Null(await Journal().ReadAsync(id));
        Assert.False(await Journal().CanReadAsync(owner, id, default));
        var created = await store.CreateAsync(new(Guid.NewGuid()), owner);
        Assert.Equal("DOCUMENT_EXISTS", (await store.CreateAsync(new(created.DocumentId), new("attacker"))).Code);
        Assert.True(await Journal().CanEditAsync(owner, created.DocumentId, default));
        Assert.False(await Journal().CanReadAsync(new("attacker"), created.DocumentId, default));
    }

    [Fact]
    public async Task FailedMemberWriteRollsBackAndKeepsOwnerAndDocumentIntact()
    {
        var store = Journal();
        var id = (await store.CreateAsync(new(Guid.NewGuid()), owner)).DocumentId;
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(directory, $"{id:N}.sqlite")};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TRIGGER fail_member BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT,'test failure'); END";
            command.ExecuteNonQuery();
        }
        await Assert.ThrowsAsync<SqliteException>(() => store.SetMemberAsync(id, "new", DocumentRole.Owner, owner));
        Assert.True(await Journal().CanEditAsync(owner, id, default));
        Assert.False(await Journal().CanReadAsync(new("new"), id, default));
        Assert.Equal(0, (await Journal().ReadAsync(id))!.Revision);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
