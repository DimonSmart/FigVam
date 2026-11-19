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
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => kind == "test" && e == PreviewEvent.Change;
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
        var empty = await new ScenarioCapabilitiesQuery(access, reader, new UnverifiedNodeProfile()).ReadAsync(doc, 4, node, screen, null, null, actor);
        Assert.Empty(empty.Response!.Events); Assert.Empty(empty.Response.Actions); Assert.Equal(PortableUiProfileReference.Production, empty.Response.Profile);
        var query = new ScenarioCapabilitiesQuery(access, reader, new Limited());
        var limited = await query.ReadAsync(doc, 4, node, screen, null, null, actor);
        Assert.Equal([PreviewEvent.Change], limited.Response!.Events); Assert.Equal(["navigate", "resetPreview"], limited.Response.Actions);
        Assert.Equal(["resetPreview"], (await query.ReadAsync(doc, 4, node, null, null, null, actor)).Response!.Actions);
        Assert.Equal("REVISION_UNAVAILABLE", (await query.ReadAsync(doc, 3, node, screen, null, null, actor)).Code);
        Assert.Equal("FORBIDDEN", (await query.ReadAsync(doc, 4, node, screen, null, null, new("outsider"))).Code);
    }
    [Fact]
    public async Task ShowVariantUsesExactValueAndScreenAtRevision()
    {
        var doc = Guid.NewGuid(); var node = Guid.NewGuid(); var screen = Guid.NewGuid(); var other = Guid.NewGuid();
        var allowed = Guid.NewGuid(); var denied = Guid.NewGuid(); var foreign = Guid.NewGuid();
        var state = new DocumentState(new(doc, [], [new(screen, [node], new(100, 100)) { Variants = [new(allowed, "Allowed", []), new(denied, "Denied", [])] }, new(other, [], new(100, 100)) { Variants = [new(foreign, "Foreign", [])] }], [new(node, "test", [])]), 4);
        var access = new Access(); var reader = new Reader(state); var actor = new DocumentActor("owner");
        var query = new ScenarioCapabilitiesQuery(access, reader, new VariantProfile(allowed));
        Assert.Contains("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, null, actor)).Response!.Actions);
        Assert.Contains("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, allowed, actor)).Response!.Actions);
        Assert.DoesNotContain("showVariant", (await query.ReadAsync(doc, 4, node, null, screen, denied, actor)).Response!.Actions);
        Assert.Equal("SCREEN_VARIANT_NOT_FOUND", (await query.ReadAsync(doc, 4, node, null, screen, foreign, actor)).Code);
        Assert.Equal("INVALID_QUERY", (await query.ReadAsync(doc, 4, node, null, null, allowed, actor)).Code);
        Assert.Equal("REVISION_UNAVAILABLE", (await query.ReadAsync(doc, 3, node, null, screen, allowed, actor)).Code);
        var production = new ScenarioCapabilitiesQuery(access, reader, new UnverifiedNodeProfile());
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, null, actor)).Response!.Actions);
        Assert.Empty((await production.ReadAsync(doc, 4, node, null, screen, allowed, actor)).Response!.Actions);
    }
    private sealed class VariantProfile(Guid allowed) : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
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
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production", ApplicationName = typeof(Program).Assembly.FullName });
        var configuration = ServerTestIdentity.Production(key).ToDictionary(item => item.Key.Replace("__", ":"), item => (string?)item.Value);
        builder.Configuration.AddInMemoryCollection(configuration);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.AddDocumentAuthentication();
        builder.Services.AddSingleton<IDocumentAuthorization>(new Access());
        builder.Services.AddSingleton<IDocumentStateReader>(new Reader(state));
        builder.Services.AddSingleton<INodeProfile>(new UnverifiedNodeProfile());
        builder.Services.AddSingleton<IScenarioCapabilitiesQuery, ScenarioCapabilitiesQuery>();
        builder.Services.AddControllers().AddApplicationPart(typeof(ScenarioCapabilitiesController).Assembly);
        await using var app = builder.Build();
        app.UseAuthentication(); app.UseAuthorization(); app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        var url = $"/api/v1/documents/{doc}/scenario-capabilities?revision=4&nodeId={node}&targetId={screen}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServerTestIdentity.Token(key, subject: "outsider"));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        using var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>();
        Assert.NotNull(result);
        Assert.Equal(doc, result.DocumentId); Assert.Equal(4, result.Revision);
        Assert.Equal(node, result.NodeId); Assert.Equal(screen, result.TargetId);
        Assert.Equal(PortableUiProfileReference.Production, result.Profile);
        Assert.Empty(result.Events); Assert.Empty(result.Actions);
        using var selected = await client.GetAsync(url + $"&screenId={screen}");
        Assert.Equal(HttpStatusCode.OK, selected.StatusCode);
        var selectedResult = await selected.Content.ReadFromJsonAsync<ScenarioCapabilitiesResponse>();
        Assert.Equal(screen, selectedResult!.ScreenId); Assert.Null(selectedResult.VariantId);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url + $"&screenId={screen}&variantId={Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url.Replace("revision=4", "revision=3"))).StatusCode);
    }

}
