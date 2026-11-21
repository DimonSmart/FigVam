using FigVam.ServiceDefaults;
using FigVam.Server.Authentication;
using FigVam.Server.Documents;
using FigVam.Server.Connectors;
using FigVam.Server.Editor;
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
builder.AddRemoteJsonConnector();
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.SuppressMapClientErrors = true;
    options.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(ApiErrors.Create(400));
});
builder.Services.AddOpenApi("v1", options => options.AddDocumentTransformer((document, _, _) =>
{
    document.Info.Title = "FigVam document API";
    document.Info.Description = "Document access and typed command API. Use Google browser sessions or the configured Bearer API mode. " +
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
    foreach (var (route, mediaType, schemaType, description) in new[]
    {
        ("/api/v1/documents/import/document.json", "application/json", JsonSchemaType.Object,
            "Raw document file; complete schema: /api/v1/schemas/document-v1.json. Maximum 16777216 bytes."),
        ("/api/v1/documents/import/container.figvam", "application/zip", JsonSchemaType.String,
            "Raw binary ZIP container; manifest schema: /api/v1/schemas/manifest-v1.json. Maximum 16842752 bytes.")
    })
        if (document.Paths.TryGetValue(route, out var path))
            foreach (var operation in path.Operations!.Values)
                operation.RequestBody = new OpenApiRequestBody
                {
                    Required = true, Description = description,
                    Content = new Dictionary<string, OpenApiMediaType>
                    {
                        [mediaType] = new() { Schema = new OpenApiSchema
                            { Type = schemaType, Format = mediaType == "application/zip" ? "binary" : null, Description = description } }
                    }
                };
    if (document.Paths.TryGetValue("/api/v1/documents/{documentId}/assets/{assetId}", out var assetPath))
        foreach (var (method, operation) in assetPath.Operations!)
        {
            var binaryContent = new Dictionary<string, OpenApiMediaType>
            { ["image/png"] = new() { Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary", MaxLength = FigVam.Domain.Documents.DocumentAssetValidator.MaxAssetBytes } } };
            if (method.ToString().Equals("PUT", StringComparison.OrdinalIgnoreCase))
                operation.RequestBody = new OpenApiRequestBody { Required = true, Content = binaryContent };
            if (method.ToString().Equals("GET", StringComparison.OrdinalIgnoreCase) && operation.Responses?.TryGetValue("200", out var success) == true)
                operation.Responses!["200"] = new OpenApiResponse { Description = success.Description, Content = binaryContent };
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
var googleMode = builder.Configuration["Authentication:Mode"] == "Google";
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    var status = exception is FigVam.Domain.Documents.PortableUiProfileException ? 400 :
        exception is BadHttpRequestException badRequest ? badRequest.StatusCode : 500;
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(ApiErrors.Create(status,
        (exception as FigVam.Domain.Documents.PortableUiProfileException)?.Code));
}));
app.UseStatusCodePages(async status =>
    await status.HttpContext.Response.WriteAsJsonAsync(ApiErrors.Create(status.HttpContext.Response.StatusCode)));
app.UseAuthentication();
if (googleMode) app.UseGoogleCsrf();
app.UseRateLimiter();
app.UseAuthorization();
app.MapDefaultEndpoints();
app.MapGet("/api/identity", (System.Security.Claims.ClaimsPrincipal user) => user.GetDocumentActor());
if (googleMode) app.MapGoogleAuth();
else app.MapGet("/api/auth/config", () => Results.Ok(new { mode = "bearer" })).AllowAnonymous();
app.MapControllers();
app.MapOpenApi();
app.MapDocumentSchemas();
app.MapEditor();
app.Run();

public partial class Program;

