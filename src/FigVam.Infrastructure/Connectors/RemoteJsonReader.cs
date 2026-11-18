using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using FigVam.Application.Connectors;

namespace FigVam.Infrastructure.Connectors;

public sealed class RemoteJsonReader : IRemoteJsonReader, IRemoteJsonConnectorCatalog, IDisposable
{
    private readonly Dictionary<string, Destination> destinations;
    private readonly IRemoteJsonSecrets secrets;
    private readonly IRemoteJsonNetwork network;
    private readonly SemaphoreSlim concurrency;
    private readonly bool allowLocalhost;
    private readonly int requestLimit, timeout, maxBytes, maxDepth, maxRedirects;
    private readonly object rateLock = new();
    private long windowStart = Stopwatch.GetTimestamp();
    private int requests;

    public RemoteJsonReader(RemoteJsonConfiguration configuration, IRemoteJsonSecrets secrets, bool isDevelopment)
        : this(configuration, secrets, isDevelopment, new RemoteJsonNetwork()) { }

    internal RemoteJsonReader(RemoteJsonConfiguration configuration, IRemoteJsonSecrets secrets, bool isDevelopment, IRemoteJsonNetwork network)
    {
        if (configuration.MaxConcurrentReads is < 1 or > 64 || configuration.RequestsPerMinute is < 1 or > 10000 ||
            configuration.TimeoutMilliseconds is < 1 or > 60000 || configuration.MaxResponseBytes is < 1 or > 16 * 1024 * 1024 ||
            configuration.MaxJsonDepth is < 1 or > 128 || configuration.MaxRedirects is < 0 or > 10 || configuration.Connectors.Count > 256 ||
            (configuration.AllowLocalhostInDevelopment && !isDevelopment))
            throw new ArgumentException("Remote JSON connector configuration is invalid.");
        this.secrets = secrets;
        this.network = network;
        allowLocalhost = isDevelopment && configuration.AllowLocalhostInDevelopment;
        concurrency = new(configuration.MaxConcurrentReads);
        requestLimit = configuration.RequestsPerMinute;
        timeout = configuration.TimeoutMilliseconds;
        maxBytes = configuration.MaxResponseBytes;
        maxDepth = configuration.MaxJsonDepth;
        maxRedirects = configuration.MaxRedirects;
        destinations = new(StringComparer.Ordinal);
        foreach (var (id, definition) in configuration.Connectors)
        {
            if (!FigVam.Domain.Documents.DatasetValidator.IsValidConnectorId(id) ||
                !Uri.TryCreate(definition.Url, UriKind.Absolute, out var uri) || definition.AllowedAuthorities.Length is < 1 or > 32)
                throw new ArgumentException("Remote JSON connector configuration is invalid.");
            var authorities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var authority in definition.AllowedAuthorities)
            {
                if (Uri.CheckHostName(authority.Host) == UriHostNameType.Unknown || authority.Port is < 1 or > 65535)
                    throw new ArgumentException("Remote JSON connector configuration is invalid.");
                authorities.Add(Authority(authority.Host, authority.Port));
            }
            var destination = new Destination(uri, authorities, definition.SecretId);
            if (!AllowedUri(uri, destination)) throw new ArgumentException("Remote JSON connector configuration is invalid.");
            destinations.Add(id, destination);
        }
    }

    public bool IsAllowed(string connectorId) => connectorId is not null && destinations.ContainsKey(connectorId);

    public async Task<RemoteJsonResult> ReadAsync(string connectorId, CancellationToken cancellationToken = default)
    {
        if (connectorId is null || !destinations.TryGetValue(connectorId, out var destination)) return new(RemoteJsonStatus.UnknownConnector);
        if (cancellationToken.IsCancellationRequested) return new(RemoteJsonStatus.Cancelled);
        lock (rateLock)
        {
            if (Stopwatch.GetElapsedTime(windowStart) >= TimeSpan.FromMinutes(1)) { windowStart = Stopwatch.GetTimestamp(); requests = 0; }
            if (requests >= requestLimit) return new(RemoteJsonStatus.RateLimited);
            requests++;
        }
        if (!concurrency.Wait(0)) return new(RemoteJsonStatus.Busy);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            return await FetchAsync(destination, deadline.Token);
        }
        catch (OperationCanceledException) { return new(cancellationToken.IsCancellationRequested ? RemoteJsonStatus.Cancelled : RemoteJsonStatus.Timeout); }
        catch (JsonException) { return new(RemoteJsonStatus.InvalidJson); }
        catch (Exception exception) when (exception is HttpRequestException or IOException or SocketException or InvalidOperationException or ArgumentException or FormatException)
        { return new(RemoteJsonStatus.UpstreamFailure); }
        finally { concurrency.Release(); }
    }

    private async Task<RemoteJsonResult> FetchAsync(Destination destination, CancellationToken token)
    {
        var uri = destination.Uri;
        for (var redirects = 0; ; redirects++)
        {
            if (!AllowedUri(uri, destination)) return new(RemoteJsonStatus.DestinationDenied);
            var addresses = IPAddress.TryParse(uri.IdnHost, out var literal) ? [literal] : await network.ResolveAsync(uri.IdnHost, token);
            if (addresses.Length == 0 || addresses.Any(address => !AllowedAddress(address, uri))) return new(RemoteJsonStatus.DestinationDenied);
            // Secrets are never forwarded to another origin, even when the redirect destination is allowlisted.
            var secret = destination.SecretId is not null && SameOrigin(uri, destination.Uri) ? secrets.GetBearerToken(destination.SecretId) : null;
            if (destination.SecretId is not null && SameOrigin(uri, destination.Uri) && string.IsNullOrWhiteSpace(secret))
                return new(RemoteJsonStatus.UpstreamFailure);
            using var response = await network.GetAsync(uri, addresses[0], secret, token);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308)
            {
                if (redirects >= maxRedirects) return new(RemoteJsonStatus.RedirectLimit);
                if (response.Headers.Location is not { } location || !Uri.TryCreate(uri, location, out var next)) return new(RemoteJsonStatus.DestinationDenied);
                uri = next;
                continue;
            }
            if (!response.IsSuccessStatusCode) return new(RemoteJsonStatus.UpstreamFailure);
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (mediaType is null || !(mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase) ||
                (mediaType.StartsWith("application/", StringComparison.OrdinalIgnoreCase) && mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase))) ||
                response.Content.Headers.ContentEncoding.Count > 0) return new(RemoteJsonStatus.InvalidJson);
            if (response.Content.Headers.ContentLength > maxBytes) return new(RemoteJsonStatus.ResponseTooLarge);
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var buffer = new MemoryStream();
            var chunk = new byte[Math.Min(8192, maxBytes + 1)];
            while (true)
            {
                var read = await stream.ReadAsync(chunk.AsMemory(0, Math.Min(chunk.Length, maxBytes + 1 - (int)buffer.Length)), token);
                if (read == 0) break;
                buffer.Write(chunk, 0, read);
                if (buffer.Length > maxBytes) return new(RemoteJsonStatus.ResponseTooLarge);
            }
            token.ThrowIfCancellationRequested();
            using var json = JsonDocument.Parse(buffer.GetBuffer().AsMemory(0, (int)buffer.Length), new JsonDocumentOptions { MaxDepth = maxDepth });
            token.ThrowIfCancellationRequested();
            return new(RemoteJsonStatus.Success, json.RootElement.Clone());
        }
    }

    private static string Authority(string host, int port) => host.Trim('[', ']').ToLowerInvariant() + ":" + port;
    private static bool SameOrigin(Uri a, Uri b) => a.IdnHost.Equals(b.IdnHost, StringComparison.OrdinalIgnoreCase) && a.Port == b.Port;
    private static bool AllowedUri(Uri uri, Destination destination) => uri.Scheme == Uri.UriSchemeHttps &&
        string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment) && destination.Authorities.Contains(Authority(uri.IdnHost, uri.Port));

    private bool AllowedAddress(IPAddress address, Uri uri)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (allowLocalhost && uri.IdnHost.Equals("localhost", StringComparison.OrdinalIgnoreCase) && IPAddress.IsLoopback(address)) return true;
        return IsPublicAddress(address);
    }

    internal static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var a = bytes[0]; var b = bytes[1]; var c = bytes[2];
            return !(a is 0 or 10 or 127 || a >= 224 || (a == 100 && b is >= 64 and <= 127) ||
                (a == 169 && b == 254) || (a == 172 && b is >= 16 and <= 31) || (a == 192 && b == 168) ||
                (a == 192 && b == 0) || (a == 192 && b == 2) || (a == 192 && b == 88 && c == 99) ||
                (a == 198 && b is 18 or 19) || (a == 198 && b == 51 && c == 100) ||
                (a == 203 && b == 0 && c == 113) || (a == 168 && b == 63 && c == 129 && bytes[3] == 16));
        }
        // Only ordinary global unicast IPv6; deny special, translated and transition ranges.
        return address.AddressFamily == AddressFamily.InterNetworkV6 && address.ScopeId == 0 && (bytes[0] & 0xe0) == 0x20 &&
            !(bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] < 0x20) &&
            !(bytes[0] == 0x20 && bytes[1] == 0x02) &&
            !(bytes[0] == 0x3f && bytes[1] == 0xff && (bytes[2] & 0xf0) == 0);
    }

    public void Dispose() => concurrency.Dispose();
    private sealed record Destination(Uri Uri, HashSet<string> Authorities, string? SecretId);
}
