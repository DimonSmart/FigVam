using System.Security.Claims;
using System.Text.Json;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FigVam.Server.Tests;

public sealed class GoogleAuthenticationTests
{
    [Fact]
    public async Task GoogleUserInfoCreatesRevocableSessionAndRejectsUnverifiedOrUninvitedUsers()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Authentication:Google:ClientId"] = "test-client",
            ["Authentication:Google:ClientSecret"] = "test-secret",
            ["Authentication:Google:BootstrapAdminEmail"] = "admin@example.com",
            ["Storage:Directory"] = Path.Combine(Path.GetTempPath(), "figvam-google-auth-tests", Guid.NewGuid().ToString("N"))
        });
        GoogleBrowserAuthentication.Configure(builder);
        using var services = builder.Services.BuildServiceProvider();
        var options = services.GetRequiredService<IOptionsMonitor<GoogleOptions>>().Get(GoogleDefaults.AuthenticationScheme);
        var store = services.GetRequiredService<FigVamUserStore>();

        async Task<ClaimsPrincipal> CreateTicket(string json)
        {
            using var profile = JsonDocument.Parse(json);
            using var tokens = OAuthTokenResponse.Success(JsonDocument.Parse("{\"access_token\":\"test\"}"));
            using var backchannel = new HttpClient();
            var principal = new ClaimsPrincipal(new ClaimsIdentity("Google"));
            var context = new OAuthCreatingTicketContext(principal, new AuthenticationProperties(),
                new DefaultHttpContext(), new AuthenticationScheme("Google", "Google", typeof(GoogleHandler)),
                options, backchannel, tokens, profile.RootElement);
            await options.Events.CreatingTicket(context);
            return principal;
        }

        var admin = await CreateTicket("{\"sub\":\"google-admin\",\"email\":\"admin@example.com\",\"email_verified\":true}");
        var id = admin.FindFirst("sub")!.Value;
        var session = admin.FindFirst("figvam_session")!.Value;
        Assert.True(store.IsActiveSession(id, session));
        store.RevokeSession(session);
        Assert.False(store.IsActiveSession(id, session));
        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateTicket("{\"sub\":\"google-admin\",\"email\":\"admin@example.com\",\"email_verified\":false}"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateTicket("{\"sub\":\"stranger\",\"email\":\"stranger@example.com\",\"email_verified\":true}"));
    }
}
