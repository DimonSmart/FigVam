using System.Security.Cryptography;
using Aspire.Hosting.ApplicationModel;

var builder = DistributedApplication.CreateBuilder(args);
var storageDirectory = Path.GetFullPath(builder.Configuration["Storage:Directory"] ??
    Path.Combine(builder.AppHostDirectory, "..", "FigVam.Server", "data", "documents"));
var server = builder.AddProject<Projects.FigVam_Server>("server")
    .WithEnvironment("Storage__Directory", storageDirectory);

// Local orchestration only. An unconfigured checkout runs exactly as before.
var tunnelId = builder.Configuration["McpTunnel:TunnelId"];
if (builder.ExecutionContext.IsRunMode && !string.IsNullOrWhiteSpace(tunnelId))
{
    var executable = builder.Configuration["McpTunnel:Executable"] ?? "tunnel-client";
    var apiKey = builder.AddParameter("openai-tunnel-api-key", secret: true);
    // One random value per AppHost lifetime, never a persisted parameter default.
    var serviceKey = builder.AddParameter("figvam-tunnel-service-key",
        "fvmt_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), secret: true);

    // Both server launch profiles provide HTTP. Only the local tunnel hop uses it;
    // the browser can still use HTTPS, and the cloud hop uses TLS.
    var endpoint = ReferenceExpression.Create($"{server.GetEndpoint("http")}/mcp");
    server.WithEnvironment("McpTunnel__Key", serviceKey);
    if (string.IsNullOrWhiteSpace(builder.Configuration["Mcp:PublicEndpoint"]))
        server.WithEnvironment("Mcp__PublicEndpoint", endpoint);
    else
        server.WithEnvironment("Mcp__PublicEndpoint", builder.Configuration["Mcp:PublicEndpoint"]);

    builder.AddExecutable("mcp-tunnel", executable, builder.AppHostDirectory, "run")
        .WithExplicitStart()
        .WaitFor(server)
        // Let the OS assign a free loopback port for the client health server.
        .WithEnvironment("HEALTH_LISTEN_ADDR", "127.0.0.1:0")
        .WithEnvironment("CONTROL_PLANE_API_KEY", apiKey)
        .WithEnvironment("CONTROL_PLANE_TUNNEL_ID", tunnelId)
        .WithEnvironment("MCP_SERVER_URL", endpoint)
        .WithEnvironment("FIGVAM_TUNNEL_KEY", serviceKey)
        .WithEnvironment("MCP_EXTRA_HEADERS", "X-FigVam-Tunnel-Key: env:FIGVAM_TUNNEL_KEY")
        .WithEnvironment("MCP_DISCOVERY_EXTRA_HEADERS", "X-FigVam-Tunnel-Key: env:FIGVAM_TUNNEL_KEY")
        .WithEnvironment("MCP_OAUTH_DISCOVERY", "disabled");
}

builder.Build().Run();
