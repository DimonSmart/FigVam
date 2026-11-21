using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using FigVam.Server.Authentication;
using Microsoft.IdentityModel.Tokens;

using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class ServerAuthenticationTests
{
    private const string Issuer = "https://identity.test";
    private const string Audience = "figvam";
    private const string LocalToken = "figvam-local-development-bearer-token";

    [Fact]
    public async Task IsolatedTestIdentityRequiresVerifiedBearerAndUsesOnlyItsSubject()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(Production(key));
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        using var anonymous = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal("Bearer", anonymous.Headers.WwwAuthenticate.Single().Scheme);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(key));
        client.DefaultRequestHeaders.Add("X-Actor-Id", "attacker");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/identity?actorId=attacker")
        {
            Content = new StringContent("{\"actorId\":\"attacker\"}", System.Text.Encoding.UTF8, "application/json")
        };
        using var valid = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        Assert.Equal("{\"id\":\"verified-user\"}", await valid.Content.ReadAsStringAsync());
        Assert.False(valid.Headers.Contains("Set-Cookie"));

        using var otherKey = RSA.Create(2048);
        string[] invalid = ["malformed", Token(otherKey), Token(key, issuer: "https://other.test"),
            Token(key, audience: "other"), Token(key, expires: DateTime.UtcNow.AddMinutes(-5)),
            Token(key, notBefore: DateTime.UtcNow.AddMinutes(5)), Token(key, subject: ""),
            Token(key, duplicateSubject: true), Token(key, unsigned: true), Token(key, noExpiration: true)];
        foreach (var token in invalid)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync("/api/identity");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        client.DefaultRequestHeaders.Authorization = null;
        client.DefaultRequestHeaders.Add("Cookie", $"access_token={Token(key)}");
        using var cookie = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.Unauthorized, cookie.StatusCode);
        using var queryToken = await client.GetAsync($"/api/identity?access_token={Token(key)}");
        Assert.Equal(HttpStatusCode.Unauthorized, queryToken.StatusCode);
    }

    [Fact]
    public async Task LocalModeRequiresExplicitBearerAndIgnoresClaimedActor()
    {
        await using var server = new ServerProcess(Local());
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        using var missing = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong");
        using var invalid = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", LocalToken);
        client.DefaultRequestHeaders.Add("X-Actor-Id", "attacker");
        using var valid = await client.GetAsync("/api/identity");
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        Assert.Equal("{\"id\":\"local-developer\"}", await valid.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("Production", "http://127.0.0.1:5211", null)]
    [InlineData("Development", "http://0.0.0.0:5211", null)]
    [InlineData("Development", "http://*:5211", null)]
    [InlineData("Development", "http://example.com:5211", null)]
    [InlineData("Development", "http://127.0.0.1:5211;http://[::]:5212", null)]
    [InlineData("Development", "http://127.0.0.1:5211", "http://0.0.0.0:5212")]
    public async Task LocalModeRefusesUnsafeEnvironmentOrBindings(string environment, string urls, string? kestrel)
    {
        var configuration = Local();
        configuration["ASPNETCORE_ENVIRONMENT"] = environment;
        configuration["ASPNETCORE_URLS"] = urls;
        if (kestrel is not null) configuration["Kestrel__Endpoints__Public__Url"] = kestrel;
        await using var server = new ServerProcess(configuration);
        await server.AssertStartupFailureAsync();
    }

    [Theory]
    [InlineData("Authentication__Issuer", "")]
    [InlineData("Authentication__Issuer", "http://identity.test")]
    [InlineData("Authentication__Audience", "")]
    [InlineData("Authentication__SigningPublicKeyPem", "")]
    [InlineData("Authentication__SigningPublicKeyPem", "invalid")]
    public async Task TestIdentityRefusesIncompleteTrust(string setting, string value)
    {
        using var key = RSA.Create(2048);
        var configuration = Production(key);
        configuration[setting] = value;
        await using var server = new ServerProcess(configuration);
        await server.AssertStartupFailureAsync();
    }

    [Fact]
    public async Task DevelopmentDoesNotImplicitlyEnableLocalAuthentication()
    {
        await using var server = new ServerProcess(new() { ["ASPNETCORE_ENVIRONMENT"] = "Development" });
        await server.AssertStartupFailureAsync();
    }

    [Fact]
    public async Task LocalModeRequiresConfiguredToken()
    {
        var configuration = Local();
        configuration["Authentication__LocalDevelopment__Token"] = "";
        await using var server = new ServerProcess(configuration);
        await server.AssertStartupFailureAsync();
    }

    [Theory]
    [InlineData("Test")]
    [InlineData("Local")]
    [InlineData("Jwt")]
    public async Task ProductionRejectsAllNonGoogleModes(string mode)
    {
        var settings = Local();
        settings["ASPNETCORE_ENVIRONMENT"] = "Production";
        settings["Authentication__Mode"] = mode;
        await using var server = new ServerProcess(settings);
        await server.AssertStartupFailureAsync();
    }

    [Fact]
    public void ActorCannotBeResolvedFromUnauthenticatedClaims()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "attacker")]));
        Assert.Throws<InvalidOperationException>(() => principal.GetDocumentActor());
    }

    private static Dictionary<string, string> Local() => new()
    {
        ["ASPNETCORE_ENVIRONMENT"] = "Development", ["Authentication__Mode"] = "Local", ["Authentication__LocalDevelopment__Enabled"] = "true",
        ["Authentication__LocalDevelopment__Token"] = LocalToken
    };

}
