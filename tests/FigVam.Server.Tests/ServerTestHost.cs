using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace FigVam.Server.Tests;

internal static class ServerTestIdentity
{
    private const string Issuer = "https://identity.test";
    private const string Audience = "figvam";
    internal static Dictionary<string, string> Production(RSA key) => new()
    {
        ["ASPNETCORE_ENVIRONMENT"] = "Production", ["Authentication__Mode"] = "Jwt", ["Authentication__Issuer"] = Issuer,
        ["Authentication__Audience"] = Audience, ["Authentication__SigningPublicKeyPem"] = key.ExportSubjectPublicKeyInfoPem()
    };

    internal static string Token(RSA key, string issuer = Issuer, string audience = Audience,
        DateTime? expires = null, DateTime? notBefore = null, string subject = "verified-user",
        bool duplicateSubject = false, bool unsigned = false, bool noExpiration = false)
    {
        var claims = new List<Claim>();
        if (subject.Length > 0) claims.Add(new Claim("sub", subject));
        if (duplicateSubject) claims.Add(new Claim("sub", "another-user"));
        var jwt = new JwtSecurityToken(issuer, audience, claims,
            notBefore ?? DateTime.UtcNow.AddMinutes(-10), noExpiration ? null : expires ?? DateTime.UtcNow.AddMinutes(10),
            unsigned ? null : new SigningCredentials(new RsaSecurityKey(key), SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

}

internal sealed class ServerProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly Task output;
    private readonly Task error;
    private readonly StringBuilder log = new();
    private readonly Stopwatch lifetime = Stopwatch.StartNew();
    private readonly int port;

    public ServerProcess(Dictionary<string, string> configuration)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            CreateNoWindow = true
        };
        start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.Environment["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-auth-tests", Guid.NewGuid().ToString("N"));
        foreach (var key in start.Environment.Keys.ToArray())
            if (key.StartsWith("Authentication__", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("Kestrel__", StringComparison.OrdinalIgnoreCase) ||
                key is "DOTNET_ENVIRONMENT" or "ASPNETCORE_HTTP_PORTS" or "ASPNETCORE_HTTPS_PORTS")
                start.Environment.Remove(key);
        start.Environment["ASPNETCORE_URLS"] = $"http://127.0.0.1:{port}";
        foreach (var entry in configuration) start.Environment[entry.Key] = entry.Value;
        process = Process.Start(start)!;
        output = CaptureAsync(process.StandardOutput, "stdout");
        error = CaptureAsync(process.StandardError, "stderr");
    }

    public HttpClient CreateClient() => new(new DiagnosticHandler(this))
    {
        // Bound the complete request, including cold endpoint activation and response buffering.
        BaseAddress = new Uri($"http://127.0.0.1:{port}"), Timeout = TimeSpan.FromSeconds(15)
    };

    public async Task WaitUntilReadyAsync(TimeSpan? timeout = null)
    {
        using var client = CreateClient();
        using var deadline = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(45));
        try
        {
            while (true)
            {
                if (process.HasExited)
                {
                    await Task.WhenAll(output, error);
                    Assert.Fail("Server exited before readiness. " + Diagnostics());
                }
                try
                {
                    using var response = await client.GetAsync("/health", deadline.Token);
                    if (response.StatusCode == HttpStatusCode.OK) return;
                }
                catch (HttpRequestException) { }
                catch (OperationCanceledException) when (!deadline.IsCancellationRequested) { }
                await Task.Delay(100, deadline.Token);
            }
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            Assert.Fail("Server readiness timed out. " + Diagnostics());
        }
    }

    public async Task AssertStartupFailureAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try { await process.WaitForExitAsync(deadline.Token); }
        catch (OperationCanceledException) { Assert.Fail("Server did not reject startup. " + Diagnostics()); }
        await Task.WhenAll(output, error);
        Assert.NotEqual(0, process.ExitCode);
        Assert.Contains("Authentication configuration is invalid", Diagnostics());
    }

    public async ValueTask DisposeAsync()
    {
        if (!process.HasExited) process.Kill(entireProcessTree: true);
        await process.WaitForExitAsync();
        await output;
        await error;
        process.Dispose();
    }

    private async Task CaptureAsync(StreamReader reader, string stream)
    {
        while (await reader.ReadLineAsync() is { } line)
            lock (log) log.AppendLine($"[{lifetime.Elapsed}] {stream}: {line}");
    }

    private string Diagnostics()
    {
        lock (log)
            return $"PID={process.Id}, port={port}, elapsed={lifetime.Elapsed}, " +
                $"exit={(process.HasExited ? process.ExitCode.ToString() : "running")}{Environment.NewLine}{log}";
    }

    private sealed class DiagnosticHandler(ServerProcess server) : DelegatingHandler(new HttpClientHandler())
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var elapsed = Stopwatch.StartNew();
            try { return await base.SendAsync(request, cancellationToken); }
            catch (OperationCanceledException exception)
            {
                // Keep cancellation semantics so the readiness polling deadline remains effective.
                throw new OperationCanceledException($"{request.Method} {request.RequestUri} canceled after {elapsed.Elapsed}. {server.Diagnostics()}", exception, cancellationToken);
            }
            catch (HttpRequestException exception)
            {
                throw new HttpRequestException($"{request.Method} {request.RequestUri} failed after {elapsed.Elapsed}. {server.Diagnostics()}", exception);
            }
        }
    }
}

