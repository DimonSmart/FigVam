using System.Security.Claims;
using System.Text.Encodings.Web;
using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

public static class McpServiceRegistration
{
    public const string Scheme = "FigVamMcp";
    internal static readonly object GrantKey = new();

    public static void AddDocumentMcp(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<McpAccessRegistry>();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddAuthentication()
            .AddScheme<AuthenticationSchemeOptions, McpBearerHandler>(Scheme, _ => { });
        builder.Services.AddMcpServer()
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<McpReadTools>()
            .WithTools<McpWriteTools>();
    }

    public static void MapDocumentMcp(this WebApplication app)
    {
        app.MapMcp("/mcp").RequireAuthorization(policy =>
            policy.AddAuthenticationSchemes(Scheme).RequireAuthenticatedUser());
    }

    public static void UseDocumentMcpAuthentication(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments("/mcp"))
            {
                await next(context);
                return;
            }

            // Only the explicitly configured public origin may send browser requests.
            // Native clients normally do not send Origin.
            var endpoint = PublicEndpoint(context.RequestServices);
            if (endpoint is null)
            {
                context.Response.StatusCode = 503;
                return;
            }
            if (context.Request.Headers.TryGetValue("Origin", out var origin) &&
                (origin.Count != 1 || !string.Equals(origin[0], endpoint.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)))
            {
                context.Response.StatusCode = 403;
                return;
            }

            var authentication = await context.AuthenticateAsync(Scheme);
            context.User = authentication.Succeeded ? authentication.Principal! : new ClaimsPrincipal(new ClaimsIdentity());
            await next(context);
        });
    }

    public static void UseDocumentMcpAccess(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments("/mcp"))
            {
                await next(context);
                return;
            }
            if (context.Items[GrantKey] is not McpDocumentGrant grant)
            {
                await context.ChallengeAsync(Scheme);
                return;
            }
            var registry = context.RequestServices.GetRequiredService<McpAccessRegistry>();
            using var lease = await registry.EnterAsync(grant, context.RequestAborted);
            if (lease is null)
            {
                await context.ChallengeAsync(Scheme);
                return;
            }
            if (!await CanEditAsync(context.RequestServices, grant.DocumentId, grant.UserId, context.RequestAborted))
            {
                registry.Remove(grant);
                await context.ChallengeAsync(Scheme);
                return;
            }
            context.Response.Headers.CacheControl = "no-store";
            await next(context);
        });
    }

    internal static async ValueTask<bool> CanEditAsync(IServiceProvider services, Guid documentId, string userId, CancellationToken ct)
    {
        if (services.GetService<FigVamUserStore>() is { } users &&
            users.ResolveMember(userId) != userId)
            return false;
        return await services.GetRequiredService<IDocumentAuthorization>()
            .CanEditAsync(new DocumentActor(userId), documentId, ct);
    }

    internal static Uri? PublicEndpoint(IServiceProvider services)
    {
        var configuration = services.GetRequiredService<IConfiguration>();
        var environment = services.GetRequiredService<IHostEnvironment>();
        var value = configuration["Mcp:PublicEndpoint"];
        if (string.IsNullOrWhiteSpace(value) && configuration["Authentication:Mode"] is "Local" or "Test")
        {
            var server = services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>();
            var urls = server.Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>()?.Addresses.ToArray();
            if (urls is { Length: 1 } && Uri.TryCreate(urls[0], UriKind.Absolute, out var listen) && listen.IsLoopback && listen.Port != 0)
                value = new Uri(listen, "/mcp").AbsoluteUri;
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var endpoint) ||
            endpoint.AbsolutePath != "/mcp" || endpoint.Query.Length != 0 ||
            endpoint.Fragment.Length != 0 || endpoint.UserInfo.Length != 0 ||
            (endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && endpoint.IsLoopback && !environment.IsProduction())))
            return null;
        return endpoint;
    }
}

public sealed class McpBearerHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
    UrlEncoder encoder, McpAccessRegistry registry) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization;
        if (header.Count != 1 || header[0] is not { } value ||
            !value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ||
            registry.Resolve(value[7..]) is not { } grant)
            return Task.FromResult(AuthenticateResult.NoResult());

        Context.Items[McpServiceRegistration.GrantKey] = grant;
        var identity = new ClaimsIdentity([new Claim("sub", grant.UserId)], Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = 401;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
