using System.Text.Json;

namespace FigVam.Application.Connectors;

// Internal application service: access control and source lifecycle must precede any public adapter.
public interface IRemoteJsonReader
{
    Task<RemoteJsonResult> ReadAsync(string connectorId, CancellationToken cancellationToken = default);
}

public enum RemoteJsonStatus
{
    Success, UnknownConnector, DestinationDenied, RateLimited, Busy, Timeout, Cancelled,
    ResponseTooLarge, InvalidJson, RedirectLimit, UpstreamFailure
}

public sealed record RemoteJsonResult(RemoteJsonStatus Status, JsonElement? Data = null);
