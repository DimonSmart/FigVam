namespace FigVam.Infrastructure.Connectors;

// Administrator-owned server configuration. Never bind this from document or API input.
public sealed class RemoteJsonConfiguration
{
    public Dictionary<string, RemoteJsonDestination> Connectors { get; set; } = [];
    public bool AllowLocalhostInDevelopment { get; set; }
    public int MaxConcurrentReads { get; set; } = 4;
    public int RequestsPerMinute { get; set; } = 30;
    public int TimeoutMilliseconds { get; set; } = 5000;
    public int MaxResponseBytes { get; set; } = 1024 * 1024;
    public int MaxJsonDepth { get; set; } = 32;
    public int MaxRedirects { get; set; } = 3;
}

public sealed class RemoteJsonDestination
{
    public string Url { get; set; } = "";
    public RemoteJsonAuthority[] AllowedAuthorities { get; set; } = [];
    public string? SecretId { get; set; }
}

public sealed class RemoteJsonAuthority
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 443;
}

// Bind separately from configuration supplied to the reader's callers; no secret enumeration API.
public interface IRemoteJsonSecrets
{
    string? GetBearerToken(string secretId);
}
