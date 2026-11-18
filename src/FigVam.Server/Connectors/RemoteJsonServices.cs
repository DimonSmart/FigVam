using FigVam.Application.Connectors;
using FigVam.Infrastructure.Connectors;

namespace FigVam.Server.Connectors;

public static class RemoteJsonServices
{
    public static void AddRemoteJsonConnector(this WebApplicationBuilder builder)
    {
        var configuration = builder.Configuration.GetSection("RemoteJson").Get<RemoteJsonConfiguration>() ?? new();
        var reader = new RemoteJsonReader(configuration, new ServerSecrets(builder.Configuration), builder.Environment.IsDevelopment());
        builder.Services.AddSingleton<IRemoteJsonReader>(_ => reader);
        builder.Services.AddSingleton<IRemoteJsonConnectorCatalog>(_ => reader);
    }

    private sealed class ServerSecrets(IConfiguration configuration) : IRemoteJsonSecrets
    {
        public string? GetBearerToken(string secretId) => configuration.GetSection("RemoteJsonSecrets")[secretId];
    }
}
