using System.Net;
using System.Net.Sockets;

namespace FigVam.Infrastructure.Connectors;

internal interface IRemoteJsonNetwork
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken);
    Task<HttpResponseMessage> GetAsync(Uri uri, IPAddress address, string? bearerToken, CancellationToken cancellationToken);
}

internal sealed class RemoteJsonNetwork : IRemoteJsonNetwork
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
        Dns.GetHostAddressesAsync(host, cancellationToken);

    public async Task<HttpResponseMessage> GetAsync(Uri uri, IPAddress address, string? bearerToken, CancellationToken cancellationToken)
    {
        var authorization = bearerToken is null ? null : new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None,
            MaxResponseHeadersLength = 16,
            ActivityHeadersPropagator = null,
            // The URI retains its hostname for certificate verification and SNI; the socket never resolves it again.
            ConnectCallback = (_, token) => ConnectAsync(address, uri.Port, token)
        };
        using var client = new HttpMessageInvoker(handler, disposeHandler: false);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri) { Version = HttpVersion.Version11 };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Authorization = authorization;
        // Invoker returns after headers. Keep handler alive until response/body disposal.
        try
        {
            var response = await client.SendAsync(request, cancellationToken);
            response.Content = new HandlerOwnedContent(response.Content, handler);
            return response;
        }
        catch { handler.Dispose(); throw; }
    }

    internal static async ValueTask<Stream> ConnectAsync(IPAddress address, int port, CancellationToken token)
    {
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), token);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch { socket.Dispose(); throw; }
    }

    private sealed class HandlerOwnedContent : HttpContent
    {
        private readonly HttpContent inner;
        private readonly SocketsHttpHandler handler;
        public HandlerOwnedContent(HttpContent inner, SocketsHttpHandler handler)
        {
            this.inner = inner;
            this.handler = handler;
            foreach (var header in inner.Headers) Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => inner.CopyToAsync(stream);
        protected override Task<Stream> CreateContentReadStreamAsync() => inner.ReadAsStreamAsync();
        protected override Task<Stream> CreateContentReadStreamAsync(CancellationToken token) => inner.ReadAsStreamAsync(token);
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { inner.Dispose(); handler.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
