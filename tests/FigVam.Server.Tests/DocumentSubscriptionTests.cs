using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Application.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;
using Json.Schema;
using static FigVam.Server.Tests.ServerTestIdentity;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentSubscriptionTests
{
    [Fact]
    public async Task FiveClientsConvergeAcrossInstancesAndConnectionCommitBoundary()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        config["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-subscriptions", Guid.NewGuid().ToString("N"));
        await using var first = new ServerProcess(config);
        await first.WaitUntilReadyAsync();
        await using var second = new ServerProcess(config);
        await second.WaitUntilReadyAsync();
        using var client = first.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        var id = Guid.NewGuid();
        var root = $"/api/v1/documents/{id}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(root + "/members", new { memberId = $"editor{i}", role = "Editor" })).StatusCode);
        var journal = new SqliteDocumentJournal(config["Storage__Directory"], new UnverifiedNodeProfile());
        var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var streams = new List<Subscription>();
        try
        {
            streams.Add(await Subscription.OpenAsync(first, key, "editor0", root, 0, deadline.Token));
            // Commit concurrently with opening streams; every stream starts from the same known revision.
            var commandIds = Enumerable.Range(0, 12).Select(_ => Guid.NewGuid()).ToArray();
            var actors = commandIds.Select((command, index) => (command, actor: $"editor{index % 5}"))
                .ToDictionary(entry => entry.command, entry => entry.actor);
            var writes = Task.WhenAll(commandIds.Select(command => handler.HandleAsync(
                new SaveDocumentCommand(id, command), new DocumentActor(actors[command]), deadline.Token)));
            for (var i = 1; i < 5; i++)
                streams.Add(await Subscription.OpenAsync(i % 2 == 0 ? first : second, key, $"editor{i}", root, 0, deadline.Token));
            Assert.All(await writes, result => Assert.True(result.Accepted));
            var replay = await handler.HandleAsync(new SaveDocumentCommand(id, commandIds[0]), new DocumentActor(actors[commandIds[0]]));
            Assert.True(replay.Accepted);
            // A rejected command must not create an event or advance revision.
            Assert.False((await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), new DocumentActor("stranger"))).Accepted);
            foreach (var stream in streams)
            {
                Assert.Equal("READY", (await stream.ReadAsync(deadline.Token)).Code);
                var changes = new List<CommittedDocumentEvent>();
                while (changes.Count < 12)
                {
                    var message = await stream.ReadAsync(deadline.Token);
                    if (message.Code == "CHANGE") changes.Add(message.Change!);
                }
                Assert.Equal(Enumerable.Range(1, 12).Select(n => (long)n), changes.Select(e => e.Revision));
                Assert.Equal(commandIds.Order(), changes.Select(e => e.CommandId).Order());
                Assert.All(changes, e => { Assert.Equal(id, e.DocumentId); Assert.Equal(actors[e.CommandId], e.ActorId); Assert.IsType<VersionSaved>(e.Payload); });
            }
            Assert.Equal(12, (await journal.ReadAsync(id))!.Revision);
            var api = JsonNode.Parse(await client.GetStringAsync("/openapi/v1.json"))!;
            Assert.NotNull(api["paths"]!["/api/v1/documents/{documentId}/events"]!["get"]!["responses"]!["200"]!["content"]!["text/event-stream"]);
            using var schemaJson = JsonDocument.Parse(await client.GetStringAsync("/api/v1/schemas/DocumentSubscriptionMessage.json"));
            var schema = JsonSchema.Build(schemaJson.RootElement.Clone());
            var ev = (await journal.ReadEventsAsync(id, 11)).Events![0];
            Assert.True(schema.EvaluateNode(JsonSerializer.SerializeToNode(new DocumentSubscriptionMessage("CHANGE", 12, ev), JsonSerializerOptions.Web)!).IsValid);
        }
        finally { foreach (var stream in streams) stream.Dispose(); }
    }

    [Fact]
    public async Task GapRecoveryRevocationAndAuthenticationAreEnforced()
    {
        using var key = RSA.Create(2048);
        var config = Production(key);
        config["Storage__Directory"] = Path.Combine(Path.GetTempPath(), "figvam-subscriptions", Guid.NewGuid().ToString("N"));
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var client = server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        var id = Guid.NewGuid();
        var root = $"/api/v1/documents/{id}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/documents", new { documentId = id })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(root + "/members", new { memberId = "viewer", role = "Viewer" })).StatusCode);
        var journal = new SqliteDocumentJournal(config["Storage__Directory"], new UnverifiedNodeProfile());
        var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
        for (var i = 0; i < 101; i++)
            Assert.True((await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), new DocumentActor("owner"))).Accepted);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        using (var missed = await Subscription.OpenAsync(server, key, "viewer", root, 0, deadline.Token))
        {
            Assert.Equal("READY", (await missed.ReadAsync(deadline.Token)).Code);
            Assert.Equal("RECONNECT_REQUIRED", (await missed.ReadAsync(deadline.Token)).Code);
            Assert.Null(await missed.Reader.ReadLineAsync(deadline.Token));
        }
        var recovered = (await client.GetFromJsonAsync<ReconnectResponse>(root + "/reconnect?lastSeenRevision=0"))!;
        Assert.Equal("SNAPSHOT", recovered.Code);
        using var live = await Subscription.OpenAsync(server, key, "viewer", root, recovered.Revision, deadline.Token);
        Assert.Equal("READY", (await live.ReadAsync(deadline.Token)).Code);
        Assert.True((await handler.HandleAsync(new SaveDocumentCommand(id, Guid.NewGuid()), new DocumentActor("owner"))).Accepted);
        var change = await live.ReadAsync(deadline.Token);
        Assert.Equal("CHANGE", change.Code);
        Assert.Equal(102, change.Revision);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync(root + "/members/viewer")).StatusCode);
        Assert.Equal("FORBIDDEN", (await live.ReadAsync(deadline.Token)).Code);
        Assert.Null(await live.Reader.ReadLineAsync(deadline.Token));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "viewer"));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(root + "/events?lastSeenRevision=102")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(root + "/events?lastSeenRevision=102")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: "owner"));
        foreach (var query in new[] { "", "?lastSeenRevision=-1", "?lastSeenRevision=103", "?lastSeenRevision=0&actorId=owner", "?lastSeenRevision=0&lastSeenRevision=1" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(root + "/events" + query)).StatusCode);
    }

    [Fact]
    public void ConnectionPermitsAreBoundedAndReleasedExactlyOnce()
    {
        var limits = new DocumentSubscriptionLimits();
        var leases = Enumerable.Range(0, 5).Select(_ => limits.TryAcquire("actor")!).ToArray();
        Assert.Null(limits.TryAcquire("actor"));
        leases[0].Dispose();
        leases[0].Dispose();
        using var replacement = limits.TryAcquire("actor");
        Assert.NotNull(replacement);
        Assert.Null(limits.TryAcquire("actor"));
        foreach (var lease in leases) lease.Dispose();
        var all = Enumerable.Range(0, 127).Select(i => limits.TryAcquire(i.ToString())!).ToArray();
        Assert.All(all, Assert.NotNull);
        Assert.Null(limits.TryAcquire("overflow"));
        foreach (var lease in all) lease.Dispose();
        using var released = limits.TryAcquire("overflow");
        Assert.NotNull(released);
    }

    private sealed class Subscription(HttpClient client, HttpResponseMessage response, StreamReader reader) : IDisposable
    {
        public StreamReader Reader => reader;
        public static async Task<Subscription> OpenAsync(ServerProcess server, RSA key, string actor,
            string root, long revision, CancellationToken cancellationToken)
        {
            var client = server.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", Token(key, subject: actor));
            var response = await client.GetAsync(root + $"/events?lastSeenRevision={revision}", HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("text/event-stream", response.Content.Headers.ContentType!.MediaType);
            return new(client, response, new StreamReader(await response.Content.ReadAsStreamAsync(cancellationToken)));
        }
        public async Task<DocumentSubscriptionMessage> ReadAsync(CancellationToken cancellationToken)
        {
            string? id = null, type = null;
            while (await reader.ReadLineAsync(cancellationToken) is { } line)
            {
                if (line.StartsWith("id: ")) id = line[4..];
                if (line.StartsWith("event: ")) type = line[7..];
                if (!line.StartsWith("data: ")) continue;
                var message = JsonSerializer.Deserialize<DocumentSubscriptionMessage>(line[6..], JsonSerializerOptions.Web)!;
                Assert.Equal(type, message.Code);
                if (message.Code == "CHANGE") Assert.Equal(message.Revision.ToString(), id);
                else Assert.Null(id);
                Assert.Equal("", await reader.ReadLineAsync(cancellationToken));
                return message;
            }
            throw new InvalidOperationException("Subscription ended before expected message.");
        }
        public void Dispose() { reader.Dispose(); response.Dispose(); client.Dispose(); }
    }
}
