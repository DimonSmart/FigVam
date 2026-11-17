using FigVam.ServiceDefaults;
using FigVam.Server.Authentication;
using FigVam.Server.Documents;
using Microsoft.AspNetCore.Mvc;
using System.Threading.RateLimiting;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.AddServiceDefaults();
try
{
    builder.AddDocumentAuthentication();
}
catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or System.Security.Cryptography.CryptographicException)
{
    Console.Error.WriteLine("Authentication configuration is invalid; server startup refused.");
    Environment.ExitCode = 1;
    return;
}

builder.AddDocumentServices();
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.SuppressMapClientErrors = true;
    options.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(ApiErrors.Create(400));
});
builder.Services.AddOpenApi("v1", options => options.AddDocumentTransformer((document, _, _) =>
{
    document.Info.Title = "FigVam document API";
    document.Info.Description = "Document access and typed command API. Bearer authentication is required. " +
        "This is not the complete design API or a verified portable profile. Errors: " +
        string.Join("; ", ApiErrors.Codes.Select(code => code + ": " + ApiErrors.Create(400, code).Detail));
    document.Components ??= new OpenApiComponents();
    document.Components.SecuritySchemes = new Dictionary<string, IOpenApiSecurityScheme>
    {
        ["Bearer"] = new OpenApiSecurityScheme { Type = SecuritySchemeType.Http, Scheme = "bearer" }
    };
    foreach (var path in document.Paths.Where(path => path.Key.StartsWith("/api/", StringComparison.Ordinal)))
        foreach (var operation in path.Value.Operations!.Values)
        {
            operation.Security ??= [];
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference("Bearer", document)] = []
            });
        }
    return Task.CompletedTask;
}));
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirst("sub")?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.RejectionStatusCode = 429;
});
var app = builder.Build();
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    var status = exception is BadHttpRequestException badRequest ? badRequest.StatusCode : 500;
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(ApiErrors.Create(status));
}));
app.UseStatusCodePages(async status =>
    await status.HttpContext.Response.WriteAsJsonAsync(ApiErrors.Create(status.HttpContext.Response.StatusCode)));
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapDefaultEndpoints();
app.MapGet("/api/identity", (System.Security.Claims.ClaimsPrincipal user) => user.GetDocumentActor());
app.MapControllers();
app.MapOpenApi();
app.MapDocumentSchemas();
app.Run();

public partial class Program;

