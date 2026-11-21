using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;

namespace FigVam.Server.Authentication;

public static class GoogleBrowserAuthentication
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;
    public const string CsrfHeader = "X-CSRF-TOKEN";

    public static void Configure(WebApplicationBuilder builder)
    {
        var config = builder.Configuration.GetSection("Authentication:Google");
        var clientId = config["ClientId"];
        var clientSecret = config["ClientSecret"];
        var bootstrapEmail = config["BootstrapAdminEmail"]?.Trim();
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret) ||
            string.IsNullOrWhiteSpace(bootstrapEmail))
            throw new InvalidOperationException("Google authentication requires ClientId, ClientSecret and BootstrapAdminEmail.");

        var dataDir = builder.Configuration["Storage:Directory"];
        if (string.IsNullOrWhiteSpace(dataDir)) throw new InvalidOperationException("Storage:Directory is required.");
        var directory = Path.GetFullPath(dataDir, builder.Environment.ContentRootPath);
        var store = new FigVamUserStore(directory);
        builder.Services.AddSingleton(store);
        builder.Services.AddAntiforgery(options => options.HeaderName = CsrfHeader);
        var keyDirectory = Path.Combine(directory, "auth-keys");
        Directory.CreateDirectory(keyDirectory);
        builder.Services.AddDataProtection().SetApplicationName("FigVam")
            .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
        builder.Services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = Scheme;
            options.DefaultSignInScheme = Scheme;
            options.DefaultChallengeScheme = Scheme;
        })
        .AddCookie(Scheme, options =>
        {
            options.Cookie.Name = "__Host-FigVam";
            options.Cookie.Path = "/";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = false;
            options.Events = new CookieAuthenticationEvents
            {
                OnValidatePrincipal = async context =>
                {
                    var id = context.Principal?.FindFirst("sub")?.Value;
                    var session = context.Principal?.FindFirst("figvam_session")?.Value;
                    if (id is null || session is null || !store.IsActiveSession(id, session))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(Scheme);
                    }
                },
                OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                },
                OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                }
            };
        })
        .AddGoogle(GoogleDefaults.AuthenticationScheme, options =>
        {
            options.ClientId = clientId;
            options.ClientSecret = clientSecret;
            options.SignInScheme = Scheme;
            options.CallbackPath = "/signin-google";
            options.SaveTokens = false;
            options.Events.OnCreatingTicket = context =>
            {
                // Google userinfo is fetched through the trusted provider, not from the browser.
                var profile = context.User;
                if (!profile.TryGetProperty("verified_email", out var verified) ||
                    verified.ValueKind != System.Text.Json.JsonValueKind.True ||
                    !profile.TryGetProperty("id", out var subject) ||
                    !profile.TryGetProperty("email", out var email))
                {
                    context.Fail("Google email verification is missing.");
                    return Task.CompletedTask;
                }
                var accepted = store.AcceptVerifiedGoogleIdentity(subject.GetString() ?? "",
                    email.GetString() ?? "", profile.TryGetProperty("name", out var name) ? name.GetString() : null,
                    bootstrapEmail);
                if (accepted is null)
                {
                    context.Fail("FigVam access has not been granted.");
                    return Task.CompletedTask;
                }
                var identity = (ClaimsIdentity)context.Principal!.Identity!;
                identity.AddClaim(new Claim("sub", accepted.Value.User.Id));
                identity.AddClaim(new Claim("figvam_session", accepted.Value.SessionId));
                return Task.CompletedTask;
            };
            options.Events.OnRemoteFailure = context =>
            {
                context.HandleResponse();
                context.Response.Redirect("/?auth_error=access_denied");
                return Task.CompletedTask;
            };
        });
        builder.Services.AddAuthorization(options =>
            options.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder(Scheme)
                .RequireAuthenticatedUser().Build());
    }

    public static void MapGoogleAuth(this WebApplication app)
    {
        app.MapGet("/api/auth/config", () => Results.Ok(new { mode = "google" })).AllowAnonymous();
        app.MapGet("/api/auth/session", (HttpContext context, FigVamUserStore users, IAntiforgery antiforgery) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (context.User.Identity?.IsAuthenticated != true)
                return Results.Ok(new { authenticated = false });
            var id = context.User.FindFirst("sub")!.Value;
            var user = users.List().FirstOrDefault(item => item.Id == id);
            if (user is null) return Results.Ok(new { authenticated = false });
            var csrf = antiforgery.GetAndStoreTokens(context).RequestToken;
            return Results.Ok(new { authenticated = true, actorId = user.Id,
                email = user.Email, admin = users.IsAdmin(user.Id), csrfToken = csrf });
        }).AllowAnonymous();
        app.MapGet("/api/auth/login", () => Results.Challenge(
            new AuthenticationProperties { RedirectUri = "/" }, [GoogleDefaults.AuthenticationScheme])).AllowAnonymous();
        app.MapPost("/api/auth/logout", async (HttpContext context, FigVamUserStore users) =>
        {
            users.RevokeSession(context.User.FindFirst("figvam_session")?.Value ?? "");
            await context.SignOutAsync(Scheme);
            return Results.Ok(new { signedOut = true });
        }).RequireAuthorization();
    }

    public static void UseGoogleCsrf(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api") &&
                (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) ||
                 HttpMethods.IsPatch(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method)) &&
                context.User.Identity?.IsAuthenticated == true &&
                !await context.RequestServices.GetRequiredService<IAntiforgery>().IsRequestValidAsync(context))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(new { code = "INVALID_CSRF", detail = "CSRF token is missing or invalid." });
                return;
            }
            await next(context);
        });
    }
}
