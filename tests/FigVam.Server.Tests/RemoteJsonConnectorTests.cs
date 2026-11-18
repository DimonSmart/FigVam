using System.Net;
using System.Net.Sockets;
using System.Text;
using FigVam.Application.Connectors;
using FigVam.Infrastructure.Connectors;

namespace FigVam.Server.Tests;

public sealed class RemoteJsonConnectorTests
{
    private static RemoteJsonConfiguration Configuration(params string[] hosts) => new()
    {
        Connectors = new()
        {
            ["catalog"] = new() { Url = "https://data.example/catalog", SecretId = "catalog-token",
                AllowedAuthorities = (hosts.Length == 0 ? ["data.example"] : hosts).Select(host => new RemoteJsonAuthority { Host = host }).ToArray() }
        }
    };

    [Fact]
    public async Task ReadsJsonByIdAndUsesServerSecretWithoutReturningIt()
    {
        var network = new Network();
        using var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network);
        var result = await reader.ReadAsync("catalog");
        Assert.Equal(RemoteJsonStatus.Success, result.Status);
        Assert.Equal(1, result.Data!.Value.GetProperty("count").GetInt32());
        Assert.Equal("server-only-secret", Assert.Single(network.Requests).Token);
        Assert.Equal("8.8.8.8", network.Requests[0].Address.ToString());
        Assert.DoesNotContain("server-only-secret", result.ToString());
        Assert.Equal(RemoteJsonStatus.UnknownConnector, (await reader.ReadAsync("https://evil.example/")).Status);
        Assert.Single(network.Requests);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.1.2.3")]
    [InlineData("172.16.0.1")]
    [InlineData("192.168.1.1")]
    [InlineData("169.254.169.254")]
    [InlineData("100.100.100.200")]
    [InlineData("168.63.129.16")]
    [InlineData("::1")]
    [InlineData("fe80::1")]
    [InlineData("fd00::1")]
    [InlineData("::ffff:10.0.0.1")]
    [InlineData("2002:7f00:1::")]
    public async Task RejectsForbiddenDnsAddressBeforeSending(string address)
    {
        var network = new Network { Resolve = _ => [IPAddress.Parse(address)] };
        using var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network);
        Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        Assert.Empty(network.Requests);
    }

    [Fact]
    public async Task RejectsMixedPublicPrivateDnsAndRechecksEveryRedirect()
    {
        var network = new Network { Resolve = _ => [IPAddress.Parse("8.8.8.8"), IPAddress.Loopback] };
        using (var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network))
            Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        Assert.Empty(network.Requests);
        network.Resolve = host => [IPAddress.Parse(host == "data.example" ? "8.8.8.8" : "10.0.0.1")];
        network.Send = (_, _) => Task.FromResult(Redirect("https://other.example/private"));
        using (var reader = new RemoteJsonReader(Configuration("data.example", "other.example"), new Secrets(), false, network))
            Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        Assert.Single(network.Requests);
    }

    [Fact]
    public async Task SameHostRedirectResolvesAgainAndCannotRebind()
    {
        var resolutions = 0;
        var network = new Network { Resolve = _ => [++resolutions == 1 ? IPAddress.Parse("8.8.8.8") : IPAddress.Loopback],
            Send = (_, _) => Task.FromResult(Redirect("/next")) };
        using var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network);
        Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        Assert.Equal(2, resolutions);
        Assert.Single(network.Requests);
    }

    [Theory]
    [InlineData("http://data.example/catalog")]
    [InlineData("https://data.example:444/catalog")]
    [InlineData("https://evil.example/catalog")]
    [InlineData("https://user:password@data.example/catalog")]
    public async Task RejectsDisallowedRedirect(string location)
    {
        var network = new Network { Send = (_, _) => Task.FromResult(Redirect(location)) };
        using var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network);
        Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        Assert.Single(network.Requests);
    }

    [Fact]
    public async Task CrossOriginRedirectDropsSecretAndRedirectCountIsBounded()
    {
        var network = new Network { Send = (uri, _) => Task.FromResult(uri.Host == "data.example" ? Redirect("https://other.example/catalog") : Json("{}")) };
        using (var reader = new RemoteJsonReader(Configuration("data.example", "other.example"), new Secrets(), false, network))
            Assert.Equal(RemoteJsonStatus.Success, (await reader.ReadAsync("catalog")).Status);
        Assert.Null(network.Requests[1].Token);
        network.Requests.Clear();
        network.Send = (_, _) => Task.FromResult(Redirect("/again"));
        var config = Configuration(); config.MaxRedirects = 1;
        using var limited = new RemoteJsonReader(config, new Secrets(), false, network);
        Assert.Equal(RemoteJsonStatus.RedirectLimit, (await limited.ReadAsync("catalog")).Status);
        Assert.Equal(2, network.Requests.Count);
    }

    [Fact]
    public async Task TimeoutAndCallerCancellationReturnOnlySafeCodes()
    {
        var config = Configuration(); config.TimeoutMilliseconds = 30;
        var network = new Network { Send = async (_, token) => { await Task.Delay(Timeout.Infinite, token); return Json("{}"); } };
        using var reader = new RemoteJsonReader(config, new Secrets(), false, network);
        Assert.Equal(new RemoteJsonResult(RemoteJsonStatus.Timeout), await reader.ReadAsync("catalog"));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        Assert.Equal(new RemoteJsonResult(RemoteJsonStatus.Cancelled), await reader.ReadAsync("catalog", cancelled.Token));
    }

    [Theory]
    [InlineData("secret-body-not-json", RemoteJsonStatus.InvalidJson)]
    [InlineData("{\"value\":\"abcdefghijklmnop\"}", RemoteJsonStatus.ResponseTooLarge)]
    [InlineData("[[[[0]]]]", RemoteJsonStatus.InvalidJson)]
    public async Task RejectsOversizeMalformedAndDeepJsonWithoutEchoingBody(string body, RemoteJsonStatus status)
    {
        var config = Configuration(); config.MaxResponseBytes = 20; config.MaxJsonDepth = 2;
        var network = new Network { Send = (_, _) => Task.FromResult(Json(body)) };
        using var reader = new RemoteJsonReader(config, new Secrets(), false, network);
        var result = await reader.ReadAsync("catalog");
        Assert.Equal(new RemoteJsonResult(status), result);
        Assert.DoesNotContain(body, result.ToString());
    }

    [Fact]
    public async Task UnknownLengthResponseCannotBypassSizeLimitAndSlowBodyCannotBypassTimeout()
    {
        var config = Configuration(); config.MaxResponseBytes = 8; config.TimeoutMilliseconds = 30;
        var network = new Network { Send = (_, _) => Task.FromResult(StreamResponse(new NonSeekableStream(Encoding.UTF8.GetBytes("[123456789]")))) };
        using var reader = new RemoteJsonReader(config, new Secrets(), false, network);
        Assert.Equal(RemoteJsonStatus.ResponseTooLarge, (await reader.ReadAsync("catalog")).Status);
        network.Send = (_, _) => Task.FromResult(StreamResponse(new SlowStream()));
        Assert.Equal(RemoteJsonStatus.Timeout, (await reader.ReadAsync("catalog")).Status);
    }

    [Fact]
    public async Task ConcurrencyAndRateLimitsRejectWithoutQueuing()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var config = Configuration(); config.MaxConcurrentReads = 1; config.RequestsPerMinute = 2;
        var network = new Network { Send = async (_, token) => { entered.SetResult(); await release.Task.WaitAsync(token); return Json("{}"); } };
        using var reader = new RemoteJsonReader(config, new Secrets(), false, network);
        var first = reader.ReadAsync("catalog"); await entered.Task;
        Assert.Equal(RemoteJsonStatus.Busy, (await reader.ReadAsync("catalog")).Status);
        Assert.Equal(RemoteJsonStatus.RateLimited, (await reader.ReadAsync("catalog")).Status);
        release.SetResult();
        Assert.Equal(RemoteJsonStatus.Success, (await first).Status);
    }

    [Fact]
    public async Task LocalhostExceptionRequiresExplicitDevelopmentAndNeverAllowsOtherPrivateHosts()
    {
        var config = Configuration("localhost"); config.Connectors["catalog"].Url = "https://localhost/catalog";
        config.AllowLocalhostInDevelopment = true;
        Assert.Throws<ArgumentException>(() => new RemoteJsonReader(config, new Secrets(), false));
        var network = new Network { Resolve = _ => [IPAddress.Loopback] };
        using (var reader = new RemoteJsonReader(config, new Secrets(), true, network))
            Assert.Equal(RemoteJsonStatus.Success, (await reader.ReadAsync("catalog")).Status);
        config.AllowLocalhostInDevelopment = false;
        using (var reader = new RemoteJsonReader(config, new Secrets(), true, network))
            Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
        config = Configuration(); config.AllowLocalhostInDevelopment = true;
        using (var reader = new RemoteJsonReader(config, new Secrets(), true, network))
            Assert.Equal(RemoteJsonStatus.DestinationDenied, (await reader.ReadAsync("catalog")).Status);
    }

    [Fact]
    public async Task ConnectionUsesSuppliedIpDirectly()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var accept = listener.AcceptTcpClientAsync(deadline.Token);
        await using var stream = await RemoteJsonNetwork.ConnectAsync(IPAddress.Loopback, port, deadline.Token);
        using var server = await accept;
        await stream.WriteAsync(new byte[] { 42 }, deadline.Token);
        var data = new byte[1];
        Assert.Equal(1, await server.GetStream().ReadAsync(data, deadline.Token));
        Assert.Equal(42, data[0]);
    }

    [Fact]
    public async Task ProductionTransportPreservesTlsHostnameAndRejectsUntrustedCertificate()
    {
        using var key = System.Security.Cryptography.RSA.Create(2048);
        var request = new System.Security.Cryptography.X509Certificates.CertificateRequest("CN=data.example", key,
            System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pkcs1);
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        string? serverName = null;
        var serverTask = Task.Run(async () =>
        {
            using var connection = await listener.AcceptTcpClientAsync(deadline.Token);
            using var tls = new System.Net.Security.SslStream(connection.GetStream());
            try
            {
                await tls.AuthenticateAsServerAsync(new System.Net.Security.SslServerAuthenticationOptions
                {
                    ServerCertificateSelectionCallback = (_, name) => { serverName = name; return certificate; }
                }, deadline.Token);
            }
            catch (Exception exception) when (exception is System.Security.Authentication.AuthenticationException or IOException) { }
        });
        var uri = new Uri($"https://data.example:{((IPEndPoint)listener.LocalEndpoint).Port}/catalog");
        await Assert.ThrowsAsync<HttpRequestException>(() => new RemoteJsonNetwork().GetAsync(uri, IPAddress.Loopback, "secret", deadline.Token));
        await serverTask;
        Assert.Equal("data.example", serverName);
    }

    [Fact]
    public async Task UpstreamErrorsDoNotDiscloseBodiesUrlsOrExceptionDetails()
    {
        var network = new Network { Send = (_, _) => throw new HttpRequestException("secret url and response body") };
        using var reader = new RemoteJsonReader(Configuration(), new Secrets(), false, network);
        Assert.Equal(new RemoteJsonResult(RemoteJsonStatus.UpstreamFailure), await reader.ReadAsync("catalog"));
        network.Send = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("secret") });
        Assert.Equal(new RemoteJsonResult(RemoteJsonStatus.UpstreamFailure), await reader.ReadAsync("catalog"));
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    private static HttpResponseMessage Redirect(string location)
    {
        var response = new HttpResponseMessage(HttpStatusCode.Found);
        response.Headers.Location = new Uri(location, UriKind.RelativeOrAbsolute); return response;
    }
    private static HttpResponseMessage StreamResponse(Stream stream)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) };
        response.Content.Headers.ContentType = new("application/json"); return response;
    }
    private sealed class Secrets : IRemoteJsonSecrets { public string? GetBearerToken(string id) => "server-only-secret"; }
    private sealed class Network : IRemoteJsonNetwork
    {
        public Func<string, IPAddress[]> Resolve { get; set; } = _ => [IPAddress.Parse("8.8.8.8")];
        public Func<Uri, CancellationToken, Task<HttpResponseMessage>> Send { get; set; } = (_, _) => Task.FromResult(Json("{\"count\":1}"));
        public List<(Uri Uri, IPAddress Address, string? Token)> Requests { get; } = [];
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken token) => Task.FromResult(Resolve(host));
        public Task<HttpResponseMessage> GetAsync(Uri uri, IPAddress address, string? bearerToken, CancellationToken token)
        { Requests.Add((uri, address, bearerToken)); return Send(uri, token); }
    }
    private sealed class SlowStream : MemoryStream
    {
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { await Task.Delay(Timeout.Infinite, cancellationToken); return 0; }
    }
    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
    }
}
