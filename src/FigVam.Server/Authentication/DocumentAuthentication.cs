using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using FigVam.Application.Documents;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace FigVam.Server.Authentication;

public static class DocumentAuthentication
{
    public static void AddDocumentAuthentication(this WebApplicationBuilder builder)
    {
        var configuration = builder.Configuration.GetSection("Authentication");
        var authentication = builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme);
        if (configuration.GetValue<bool>("LocalDevelopment:Enabled"))
        {
            if (!builder.Environment.IsDevelopment())
                throw new InvalidOperationException("Local authentication requires the Development environment.");
            var urls = builder.Configuration["urls"]?.Split(';', StringSplitOptions.RemoveEmptyEntries);
            if (urls is not { Length: > 0 } || builder.Configuration.GetSection("Kestrel:Endpoints").GetChildren().Any())
                throw new InvalidOperationException("Local authentication requires explicit loopback URLs and no Kestrel endpoint overrides.");
            var addresses = urls.Select(url =>
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out var address) ||
                    address.Scheme is not ("http" or "https") ||
                    !(address.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                      (IPAddress.TryParse(address.Host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip))))
                    throw new InvalidOperationException("Local authentication permits only loopback listen addresses.");
                return address;
            }).ToArray();
            var token = configuration["LocalDevelopment:Token"];
            if (string.IsNullOrWhiteSpace(token) || Encoding.UTF8.GetByteCount(token) < 32)
                throw new InvalidOperationException("Local authentication requires a bearer token of at least 32 UTF-8 bytes.");

            // Explicit sockets prevent hosting URL/port overrides from widening the local boundary.
            builder.WebHost.ConfigureKestrel(options =>
            {
                foreach (var address in addresses)
                {
                    var ip = address.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                        ? IPAddress.Loopback : IPAddress.Parse(address.Host.Trim('[', ']'));
                    options.Listen(ip, address.Port, listen =>
                    {
                        if (address.Scheme == "https") listen.UseHttps();
                    });
                }
            });
            authentication.AddScheme<LocalBearerOptions, LocalBearerHandler>(JwtBearerDefaults.AuthenticationScheme,
                options => options.Token = token);
        }
        else
        {
            var issuer = configuration["Issuer"];
            var audience = configuration["Audience"];
            var publicKey = configuration["SigningPublicKeyPem"];
            if (!Uri.TryCreate(issuer, UriKind.Absolute, out var issuerUri) || issuerUri.Scheme != "https" ||
                string.IsNullOrWhiteSpace(audience) || string.IsNullOrWhiteSpace(publicKey))
                throw new InvalidOperationException("Bearer authentication requires HTTPS Issuer, Audience and SigningPublicKeyPem.");
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKey);
            if (rsa.KeySize < 2048 || publicKey.Contains("PRIVATE KEY", StringComparison.Ordinal))
                throw new InvalidOperationException("Configure only an RSA public key of at least 2048 bits.");
            var key = new RsaSecurityKey(rsa.ExportParameters(false));
            authentication.AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.IncludeErrorDetails = false;
                options.SaveToken = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true, ValidIssuer = issuer,
                    ValidateAudience = true, ValidAudience = audience,
                    ValidateIssuerSigningKey = true, IssuerSigningKey = key,
                    RequireSignedTokens = true, RequireExpirationTime = true, ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromSeconds(30), ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
                    NameClaimType = "sub"
                };
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = context =>
                    {
                        if (!HasSingleSubject(context.Principal!)) context.Fail("A unique subject is required.");
                        return Task.CompletedTask;
                    }
                };
            });
        }
        builder.Services.AddAuthorization(options => options.FallbackPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser().Build());
    }

    public static DocumentActor GetDocumentActor(this ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true || !HasSingleSubject(principal))
            throw new InvalidOperationException("A verified identity with a unique subject is required.");
        return new DocumentActor(principal.FindFirst("sub")!.Value);
    }

    private static bool HasSingleSubject(ClaimsPrincipal principal)
    {
        var subjects = principal.FindAll("sub").ToArray();
        return subjects.Length == 1 && !string.IsNullOrWhiteSpace(subjects[0].Value);
    }
}

public sealed class LocalBearerOptions : AuthenticationSchemeOptions
{
    public string Token { get; set; } = "";
}

public sealed class LocalBearerHandler(IOptionsMonitor<LocalBearerOptions> options, ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<LocalBearerOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (Context.Connection.LocalIpAddress is not { } local || !IPAddress.IsLoopback(local) ||
            Context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote))
            return Task.FromResult(AuthenticateResult.Fail("Local authentication requires a loopback connection."));
        var authorization = Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult(AuthenticateResult.NoResult());
        var supplied = SHA256.HashData(Encoding.UTF8.GetBytes(authorization[7..]));
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(Options.Token));
        if (!CryptographicOperations.FixedTimeEquals(supplied, expected))
            return Task.FromResult(AuthenticateResult.Fail("Invalid local bearer token."));
        var identity = new ClaimsIdentity([new Claim("sub", "local-developer")], Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
