using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace FigVam.Server.Mcp;

// This credential authenticates the local transport, not a document or a REST user.
public sealed class McpTunnelCredential
{
    public const string Header = "X-FigVam-Tunnel-Key";
    private readonly byte[]? fingerprint;

    private McpTunnelCredential(byte[]? fingerprint) => this.fingerprint = fingerprint;
    public bool Enabled => fingerprint is not null;

    internal static McpTunnelCredential Create(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment() && !(environment.IsEnvironment("Testing") && configuration["Authentication:Mode"] == "Test"))
            return new(null);

        var key = configuration["McpTunnel:Key"];
        if (string.IsNullOrEmpty(key)) return new(null);
        if (key.Length != 69 || !key.StartsWith("fvmt_", StringComparison.Ordinal) || !key.Skip(5).All(Uri.IsHexDigit))
            throw new InvalidOperationException("Invalid FigVam tunnel credential configuration.");
        return new(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
    }

    internal bool Matches(HttpContext context, string? key) =>
        fingerprint is not null && key is { Length: 69 } &&
        IsLoopback(context.Connection.RemoteIpAddress) && IsLoopback(context.Connection.LocalIpAddress) &&
        CryptographicOperations.FixedTimeEquals(fingerprint, SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    private static bool IsLoopback(IPAddress? address) => address is not null &&
        IPAddress.IsLoopback(address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address);
}
