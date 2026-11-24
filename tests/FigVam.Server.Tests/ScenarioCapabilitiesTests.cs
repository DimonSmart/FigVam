using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Server.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;

namespace FigVam.Server.Tests;

public sealed class ScenarioCapabilitiesTests
{
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id == "owner");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentState state) : IDocumentStateReader
    {
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct = default) => Task.FromResult(revision == state.Revision ? new DocumentStateReadResult("OK", state) : new DocumentStateReadResult("REVISION_UNAVAILABLE"));
    }
    private sealed class Limited : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => kind == "test" && e == PreviewEvent.Change;
        public IReadOnlyList<string> PreviewActions => ["navigate", "resetPreview"];
        public bool SupportsPreviewAction(PreviewAction action) => action is Navigate or ResetPreview;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => true;
        public bool CanContainChildren(string kind) => false;
    }
    [Fact]
    public async Task CapabilitiesUseInstalledProfileAndExactRevisionAndTarget()
    {
        var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var screen = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [node], new(100, 100))], [new(node, "test", [])]), 4);
        var access = new Access(); var reader = new Reader(state); var actor = new DocumentActor("owner");
        var empty = await new ScenarioCapabilitiesQuery(access, reader, new EmptyNodeProfile()).ReadAsync(doc, 4, node, screen, null, null, null, null, null, actor);
        Assert.Empty(empty.Response!.Events); Assert.Empty(empty.Response.Actions); Assert.Equal(PortableUiProfileReference.Current, empty.Response.Profile);
        var query = new ScenarioCapabilitiesQuery(access, reader, new Limited());
        var limited = await query.ReadAsync(doc, 4, node, screen, null, null, null, null, null, actor);
        Assert.Equal([PreviewEvent.Change], limited.Response!.Events); Assert.Equal(["navigate", "resetPreview"], limited.Response.Actions);
        var withoutTarget = (await query.ReadAsync(doc, 4, node, null, null, null, null, null, null, actor)).Response!;
        Assert.Equal(["resetPreview"], withoutTarget.Actions);
        Assert.Equal(["navigate", "resetPreview"], withoutTarget.PotentialActions);
        Assert.Equal("REVISION_UNAVAILABLE", (await query.ReadAsync(doc, 3, node, screen, null, null, null, null, null, actor)).Code);
        Assert.Equal("FORBIDDEN", (await query.ReadAsync(doc, 4, node, screen, null, null, null, null, null, new("outsider"))).Code);
    }
    [Fact]
    public async Task PrefixUsesNavigationAndOverlayContexts()
    {
        var doc = Guid.NewGuid(); var source = Guid.NewGuid(); var start = Guid.NewGuid();
        var target = Guid.NewGuid(); var overlay = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(start, [source], new(100, 100)), new(target, [], new(100, 100)), new(overlay, [], new(100, 100))], [new(source, "Button", [])]), 4);
        var query = new ScenarioCapabilitiesQuery(new Access(), new Reader(state), new VisualNodeProfile());
        async Task<ScenarioCapabilitiesResponse> Read(params PreviewAction[] prefix)
            => (await query.ReadAsync(doc, 4, source, null, null, null, null, null, null, new("owner"), sourceScreenId: start, prefix: prefix)).Response!;
        var opened = await Read(new Navigate(target), new OpenOverlay(overlay));
        Assert.Equal(target, opened.NavigationScreenId);
        Assert.Equal(overlay, opened.DemoScreenId);
        var closed = await Read(new Navigate(target), new OpenOverlay(overlay), new CloseOverlay());
        Assert.Equal(target, closed.DemoScreenId);
        Assert.Null((await Read(new CloseOverlay())).NavigationScreenId);
        Assert.Null((await Read(new ResetPreview())).DemoScreenId);
        Assert.Contains("navigate", opened.PotentialActions);
    }

    [Fact]
    public async Task ShowVariantUsesExactValueAndScreenAtRevision()
    {
        var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var screen = Guid.NewGuid(); var other = Guid.NewGuid();
        var allowed = Guid.NewGuid(); var denied = Guid.NewGuid(); var foreign = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [node], new(100, 100)) { Variants = [new(allowed, "Allowed", []), new(denied, "Denied", [])] }, new(other, [], new(100, 100)) { Variants = [new(foreign, "Foreign", [])] }], [new(node, "test", [])]), 4);
        var access = new Access(); var reader = new Reader(state); var actor = new DocumentActor("owner");
        var query = new ScenarioCapabilitiesQuery(access, reader, new VariantProfile(allowed));
        Assert.Contains("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, null, null, null, null, actor)).Response!.Actions);
        Assert.Contains("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, allowed, null, null, null, actor)).Response!.Actions);
        Assert.DoesNotContain("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, denied, null, null, null, actor)).Response!.Actions);
        Assert.Equal("SCREEN_VARIANT_NOT_FOUND", (await query.ReadAsync(doc, 4, node, null, screen, foreign, null, null, null, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await query.ReadAsync(doc, 4, node, null, null, allowed, null, null, null, actor)).Code);
        Assert.Equal("REVISION_UNAVAILABLE", (await query.ReadAsync(doc, 3, node, null, screen, allowed, null, null, null, actor)).Code);
        var production = new ScenarioCapabilitiesQuery(access, reader, new EmptyNodeProfile());
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, null, null, null, null, actor)).Response!.Actions);
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, allowed, null, null, null, actor)).Response!.Actions);
    }
    [Fact]
    public async Task SelectDatasetUsesExactValueAndRevisionAndAuthorization()
    {
        var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var screen = Guid.NewGuid();
        var allowed = Guid.NewGuid(); var denied = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [node], new(100, 100))], [new(node, "test", [])]) { Datasets = [new(allowed, "Allowed", "{}"), new(denied, "Denied", "{}")] }, 4);
        var query = new ScenarioCapabilitiesQuery(new Access(), new Reader(state), new DatasetProfile(allowed));
        var actor = new DocumentActor("owner");
        Assert.Contains("selectDataset", (await query.ReadAsync(doc, 4, node, null, screen, null, null, null, null, actor)).Response!.Actions);
        Assert.Contains("selectDataset", (await query.ReadAsync(doc, 4, node, null, screen, null, allowed, null, null, actor)).Response!.Actions);
        Assert.DoesNotContain("selectDataset", (await query.ReadAsync(doc, 4, node, null, screen, null, denied, null, null, actor)).Response!.Actions);
        Assert.Equal("DATASET_NOT_FOUND", (await query.ReadAsync(doc, 4, node, null, screen, null, Guid.NewGuid(), null, null, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await query.ReadAsync(doc, 4, node, null, screen, null, Guid.Empty, null, null, actor)).Code);
        Assert.Equal("REVISION_UNAVAILABLE", (await query.ReadAsync(doc, 3, node, null, screen, null, allowed, null, null, actor)).Code);
        Assert.Equal("FORBIDDEN", (await query.ReadAsync(doc, 4, node, null, screen, null, allowed, null, null, new("outsider"))).Code);
        var production = new ScenarioCapabilitiesQuery(new Access(), new Reader(state), new EmptyNodeProfile());
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, null, null, null, null, actor)).Response!.Actions);
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, null, allowed, null, null, actor)).Response!.Actions);
    }
    [Fact]
    public async Task DemoValueChecksExactNodeValueAndEligibility()
    {
        var doc = Guid.NewGuid(); var source = Guid.NewGuid(); var target = Guid.NewGuid(); var other = Guid.NewGuid(); var screen = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [source, target], new(100, 100))], [new(source, "test", []), new(target, "test", []), new(other, "test", [])]), 4);
        var query = new ScenarioCapabilitiesQuery(new Access(), new Reader(state), new DemoProfile(target));
        var actor = new DocumentActor("owner");
        async Task<ScenarioCapabilitiesResult> Read(Guid id, string? value) => await query.ReadAsync(doc, 4, source, null, screen, null, null, id, value, actor);
        Assert.Contains("setDemoValue", (await Read(target, null)).Response!.Actions);
        Assert.Contains("setDemoValue", (await Read(target, "allowed")).Response!.Actions);
        Assert.Contains("setDemoValue", (await Read(target, new string('\u044f', 4096))).Response!.Actions);
        Assert.DoesNotContain("setDemoValue", (await Read(target, "")).Response!.Actions);
        Assert.DoesNotContain("setDemoValue", (await Read(target, "denied")).Response!.Actions);
        Assert.DoesNotContain("setDemoValue", (await Read(source, "allowed")).Response!.Actions);
        Assert.DoesNotContain("setDemoValue", (await Read(other, null)).Response!.Actions);
        Assert.Equal("INVALID_QUERY", (await Read(target, new string('x', 4097))).Code);
        var production = new ScenarioCapabilitiesQuery(new Access(), new Reader(state), new EmptyNodeProfile());
        Assert.Empty((await production.ReadAsync(doc, 4, source, null, screen, null, null, target, null, actor)).Response!.Actions);
    }
    private sealed class DemoProfile(Guid target) : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => action is SetDemoValue a && a.NodeId == target && (a.Value is null || a.Value == "allowed" || a.Value == new string('\u044f', 4096));
        public bool SupportsDemoValue(string kind) => kind == "test";
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => true;
        public bool CanContainChildren(string kind) => false;
    }
    private sealed class DatasetProfile(Guid allowed) : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => action is SelectDataset d && (d.DatasetId is null || d.DatasetId == allowed);
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => true;
        public bool CanContainChildren(string kind) => false;
    }
    private sealed class VariantProfile(Guid allowed) : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => false;
        public bool SupportsPreviewAction(PreviewAction action) => action is ShowVariant v && (v.VariantId is null || v.VariantId == allowed);
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => true;
        public bool CanContainChildren(string kind) => false;
    }
    [Fact]
    public async Task HttpRouteRequiresIdentityAndDocumentAccessAndReturnsProfileCapabilities()
    {
        var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var screen = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [node], new(100, 100))], [new(node, "test", [])]), 4);
        using var key = RSA.Create(2048);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", ApplicationName = typeof(Program).Assembly.FullName });
        var configuration = ServerTestIdentity.Production(key).ToDictionary(item => item.Key.Replace("__", ":"), item => (string?)item.Value);
        builder.Configuration.AddInMemoryCollection(configuration);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.AddDocumentAuthentication();
        builder.Services.AddSingleton<IDocumentAuthorization>(new Access());
        builder.Services.AddSingleton<IDocumentStateReader>(new Reader(state));
        builder.Services.AddSingleton<INodeProfile>(new EmptyNodeProfile());
        builder.Services.AddSingleton<IScenarioCapabilitiesQuery, ScenarioCapabilitiesQuery>();
        builder.Services.AddControllers().AddApplicationPart(typeof(ScenarioCapabilitiesController).Assembly);
        await using var app = builder.Build();
        app.UseAuthentication(); app.UseAuthorization(); app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        var url = $"/api/v1/documents/{doc}/scenario-capabilities?revision=4&nodeId={node}&targetId={screen}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(url, new { demoValue = (string?)null })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(url, new { demoValue = (string?)null })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        using var response = await client.PostAsJsonAsync(url, new { demoValue = (string?)null });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>();
        Assert.NotNull(result);
        Assert.Equal(doc, result.DocumentId); Assert.Equal(4, result.Revision);
        Assert.Equal(node, result.NodeId); Assert.Equal(screen, result.TargetId);
        Assert.Equal(PortableUiProfileReference.Current, result.Profile);
        Assert.Empty(result.Events); Assert.Empty(result.Actions);
        using var selected = await client.PostAsJsonAsync(url + $"&screenId={screen}", new { demoValue = (string?)null });
        Assert.Equal(HttpStatusCode.OK, selected.StatusCode);
        var selectedResult = await selected.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>();
        Assert.Equal(screen, selectedResult!.ScreenId); Assert.Null(selectedResult.VariantId);
        using var demo = await client.PostAsJsonAsync(url + $"&screenId={screen}&demoNodeId={node}", new { demoValue = "" });
        var demoResult = await demo.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>();
        Assert.Equal(node, demoResult!.DemoNodeId); Assert.Equal("", demoResult.DemoValue);
        using var nullDemo = await client.PostAsJsonAsync(url + $"&screenId={screen}&demoNodeId={node}", new { demoValue = (string?)null });
        Assert.Null((await nullDemo.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>())!.DemoValue);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + $"&screenId={screen}&variantId={Guid.NewGuid()}", new { demoValue = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + $"&datasetId={Guid.NewGuid()}", new { demoValue = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + $"&datasetId={Guid.Empty}", new { demoValue = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url.Replace("revision=4", "revision=3"), new { demoValue = (string?)null })).StatusCode);
        var maximum = new string('\u044f', 4096);
        using var longValue = await client.PostAsJsonAsync(url + $"&screenId={screen}&demoNodeId={node}", new { demoValue = maximum });
        Assert.Equal(HttpStatusCode.OK, longValue.StatusCode);
        Assert.Equal(maximum, (await longValue.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>())!.DemoValue);
    }

}
