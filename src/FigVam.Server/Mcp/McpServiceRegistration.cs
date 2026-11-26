using System.Security.Claims;
using System.Text.Encodings.Web;
using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

public static class McpServiceRegistration
{
    public const string Scheme = "FigVamMcp";
    internal static readonly object GrantKey = new();
    internal static readonly object TunnelKey = new();

    public static void AddDocumentMcp(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<McpAccessRegistry>();
        builder.Services.AddSingleton<ScreenCaptureService>();
        builder.Services.AddSingleton<HeadlessPreviewCapture>();
        builder.Services.AddSingleton<IScreenCaptureService>(sp => sp.GetRequiredService<ScreenCaptureService>());
        builder.Services.AddSingleton(McpTunnelCredential.Create(builder.Configuration, builder.Environment));
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddAuthentication()
            .AddScheme<AuthenticationSchemeOptions, McpBearerHandler>(Scheme, _ => { });
        builder.Services.AddMcpServer()
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithRequestFilters(filters => filters.AddCallToolFilter(next => async (context, ct) =>
            {
                // The gateway may discover static tool schemas without a document. No tool may run without an admitted grant.
                var http = context.Services?.GetService<IHttpContextAccessor>()?.HttpContext;
                if (http?.Items[GrantKey] is not McpDocumentGrant)
                {
                    var data = JsonSerializer.SerializeToElement(new { status = "REJECTED", code = "MCP_TUNNEL_ACCESS_REQUIRED",
                        message = "Open the intended document in FigVam and explicitly allow ChatGPT tunnel access." });
                    return new CallToolResult { IsError = true, StructuredContent = data, Content = [new TextContentBlock { Text = data.GetRawText() }] };
                }
                return await next(context, ct);
            }))
            .WithRequestFilters(filters => filters.AddListToolsFilter(next => async (context, ct) =>
            {
                var result = await next(context, ct);
                foreach (var tool in result.Tools.Where(t => t.Name == "render_screen"))
                {
                    var schema = System.Text.Json.Nodes.JsonNode.Parse(tool.InputSchema.GetRawText())!.AsObject();
                    schema["properties"]!["theme"] = System.Text.Json.Nodes.JsonNode.Parse(
                        """{"description":"Optional render-only theme; omit to use the current prototype theme.","anyOf":[{"type":"string","enum":["Light","Dark"]},{"type":"null"}]}""");
                    tool.InputSchema = JsonSerializer.SerializeToElement(schema);
                }
                return result;
            }))
            .WithTools<McpReadTools>()
            .WithTools<McpRenderTools>()
            .WithTools<McpPreviewTools>()
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
                if (context.Items.ContainsKey(TunnelKey))
                {
                    // Metadata/initialization remain available after revoke; the tool filter denies all document operations.
                    context.Response.Headers.CacheControl = "no-store";
                    await next(context);
                }
                else await context.ChallengeAsync(Scheme);
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
    UrlEncoder encoder, McpAccessRegistry registry, McpTunnelCredential tunnel) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (Request.Headers.TryGetValue(McpTunnelCredential.Header, out var serviceKey))
        {
            if (serviceKey.Count != 1 || !tunnel.Matches(Context, serviceKey[0]) || Request.Headers.Authorization.Count != 0)
                return Task.FromResult(AuthenticateResult.NoResult());
            Context.Items[McpServiceRegistration.TunnelKey] = true;
            var selected = registry.GetTunnelGrant();
            if (selected is not null) Context.Items[McpServiceRegistration.GrantKey] = selected;
            var principal = new ClaimsPrincipal(selected is null ? new ClaimsIdentity(Scheme.Name) :
                new ClaimsIdentity([new Claim("sub", selected.UserId)], Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
        }
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
