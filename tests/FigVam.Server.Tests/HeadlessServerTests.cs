using System.Net;
using System.Security.Cryptography;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public class HeadlessServerTests
{
    [Fact]
    public async Task ServerStartsAndServesHealthEndpointsInProduction()
    {
        using var key = RSA.Create(2048);
        await using var server = new ServerProcess(ServerTestIdentity.Production(key));
        await server.WaitUntilReadyAsync(TimeSpan.FromSeconds(30));
        using var client = server.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(2);
        foreach (var endpoint in new[] { "/health", "/alive" })
        {
            using var response = await client.GetAsync(endpoint);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
        }
    }
}
