using FigVam.Server.Authentication;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Tests;

public sealed class GoogleUserStoreTests
{
    private static FigVamUserStore NewStore() =>
        new(Path.Combine(Path.GetTempPath(), "figvam-google-user-tests", Guid.NewGuid().ToString("N")));

    [Fact]
    public void BootstrapOnlyAllowsConfiguredVerifiedIdentityAndKeepsStableId()
    {
        var store = NewStore();
        Assert.Null(store.AcceptVerifiedGoogleIdentity("google-unknown", "stranger@example.com", "Unknown", "admin@example.com"));
        var first = store.AcceptVerifiedGoogleIdentity("google-admin", "admin@example.com", "Administrator", "admin@example.com");
        Assert.NotNull(first);
        Assert.StartsWith("google:", first.Value.User.Id);
        Assert.True(first.Value.User.IsAdmin);
        Assert.True(store.IsActiveSession(first.Value.User.Id, first.Value.SessionId));
        Assert.Null(store.AcceptVerifiedGoogleIdentity("google-new", "new-admin@example.com", null, "new-admin@example.com"));
        var again = store.AcceptVerifiedGoogleIdentity("google-admin", "admin@example.com", "Admin", "admin@example.com");
        Assert.Equal(first.Value.User.Id, again!.Value.User.Id);
        Assert.NotEqual(first.Value.SessionId, again.Value.SessionId);
        Assert.Equal(first.Value.User.Id, store.ResolveMember("admin@example.com"));
    }

    [Fact]
    public void InvitationBindsOnceAndPersistsAcrossRestarts()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-google-user-tests", Guid.NewGuid().ToString("N"));
        var store = new FigVamUserStore(directory);
        var admin = store.AcceptVerifiedGoogleIdentity("admin-sub", "admin@example.com", null, "admin@example.com")!.Value;
        var invited = store.Invite("Person@Example.com");
        Assert.False(invited.IsBound);
        Assert.Null(store.ResolveMember("person@example.com"));
        var first = store.AcceptVerifiedGoogleIdentity("person-sub", "person@example.com", "Person", "admin@example.com")!.Value;
        Assert.Equal(invited.Id, first.User.Id);
        Assert.False(first.User.IsAdmin);
        Assert.Null(store.AcceptVerifiedGoogleIdentity("other-sub", "person@example.com", null, "admin@example.com"));
        var reopened = new FigVamUserStore(directory);
        Assert.Equal(invited.Id, reopened.ResolveMember("PERSON@EXAMPLE.COM"));
        Assert.True(reopened.IsActiveSession(first.User.Id, first.SessionId));
        Assert.True(reopened.IsAdmin(admin.User.Id));
        reopened.RevokeSession(first.SessionId);
        Assert.False(store.IsActiveSession(first.User.Id, first.SessionId));
    }

    [Fact]
    public void BlockingRevokesAllSessionsAndLastAdminCannotBeDemoted()
    {
        var store = NewStore();
        var admin = store.AcceptVerifiedGoogleIdentity("admin", "admin@example.com", null, "admin@example.com")!.Value;
        Assert.Throws<InvalidOperationException>(() => store.Update(admin.User.Id, false, false));
        Assert.Throws<InvalidOperationException>(() => store.Update(admin.User.Id, true, false));
        var pendingAdmin = store.Invite("future-admin@example.com");
        Assert.True(store.Update(pendingAdmin.Id, true, true));
        Assert.Throws<InvalidOperationException>(() => store.Update(admin.User.Id, false, false));
        var user = store.Invite("user@example.com");
        var login = store.AcceptVerifiedGoogleIdentity("user-sub", "user@example.com", null, "admin@example.com")!.Value;
        Assert.True(store.IsActiveSession(login.User.Id, login.SessionId));
        Assert.True(store.Update(user.Id, false, false));
        Assert.False(store.IsActiveSession(login.User.Id, login.SessionId));
        Assert.Null(store.AcceptVerifiedGoogleIdentity("user-sub", "user@example.com", null, "admin@example.com"));
        Assert.True(store.Update(user.Id, true, false));
        Assert.False(store.IsActiveSession(login.User.Id, login.SessionId));
    }

    [Fact]
    public void EmailCollisionsAndInvalidInvitationsFailClosed()
    {
        var store = NewStore();
        store.AcceptVerifiedGoogleIdentity("admin", "admin@example.com", null, "admin@example.com");
        store.Invite("one@example.com");
        Assert.Throws<SqliteException>(() => store.Invite("ONE@example.com"));
        Assert.Throws<ArgumentException>(() => store.Invite("not-an-email"));
        Assert.Null(store.AcceptVerifiedGoogleIdentity("other", "uninvited@example.com", null, "admin@example.com"));
    }
}
