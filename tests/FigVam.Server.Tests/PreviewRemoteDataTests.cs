using System.Text.Json;
using FigVam.Application.Connectors;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class PreviewRemoteDataTests
{
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "text" ? new(NodePropertyType.String) : null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => true;
        public bool SupportsPreviewAction(PreviewAction action) => true;
        public bool SupportsDemoValue(string kind) => true;
    }
    private sealed class Authorization : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public bool Allowed = true;
        public int Checks;
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct)
        { Checks++; return ValueTask.FromResult(Allowed && actor.Id == "viewer"); }
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(false);
    }
    private sealed class Reader(DocumentStructure document) : IDocumentStateReader
    {
        public Task<DocumentStateReadResult> ReadAsync(Guid id, long? revision, CancellationToken ct)
            => Task.FromResult(new DocumentStateReadResult("OK", new(document, 7)));
    }
    private sealed class Remote : IRemoteJsonReader
    {
        public int Calls;
        public string? Connector;
        public Func<CancellationToken, Task<RemoteJsonResult>> Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success,
            JsonSerializer.SerializeToElement(new { title = "remote-private", items = new[] { new { name = "A" }, new { name = "B" } } })));
        public Task<RemoteJsonResult> ReadAsync(string connectorId, CancellationToken ct = default)
        { Calls++; Connector = connectorId; return Read(ct); }
    }
    private sealed class Fixture
    {
        public readonly Guid Dataset = Guid.NewGuid(), Alternative = Guid.NewGuid(), Screen = Guid.NewGuid(), Owner = Guid.NewGuid(), Template = Guid.NewGuid(), Empty = Guid.NewGuid();
        public readonly Profile Profile = new();
        public readonly Authorization Auth = new();
        public readonly Remote Remote = new();
        public DocumentStructure Document { get; }
        public PreviewSelection Selection => new(Screen, null, Dataset, TokenTheme.Light, new(800, 600));
        public Fixture()
        {
            var owner = new NodeStructure(Owner, "test", [Template, Empty])
            {
                DataBindings = System.Collections.Immutable.ImmutableSortedDictionary<string, NodeDataBinding>.Empty.Add("text",
                    new(Dataset, new([new DataProperty("title")], ExpectedType: DataExpectedType.String))),
                Repeater = new(Dataset, new([new DataProperty("items")], ExpectedType: DataExpectedType.Array), Template, Empty,
                    [new(Template, "text", new([new DataProperty("name")], ExpectedType: DataExpectedType.String))])
            };
            Document = new(Guid.NewGuid(), [], [new(Screen, [Owner], new(800, 600))], [owner, new(Template, "test", []), new(Empty, "test", [])])
            {
                Datasets = [new(Dataset, "Saved", "{\"title\":\"fixture\",\"items\":[]}", "trusted"),
                    new(Alternative, "Other", "{\"title\":\"alternative\",\"items\":[{\"name\":\"local\"}]}")]
            };
        }
        public async Task<DocumentPreview> Create() => (await new DocumentPreviewFactory(Auth, new Reader(Document), Profile, Remote)
            .CreateAsync(Document.Id, 7, Selection, new("viewer"))).Preview!;
    }
    private static readonly DocumentActor Viewer = new("viewer");

    [Fact]
    public async Task ExplicitRefreshEvaluatesRemoteDataAndRetainsOnlyEphemeralPayloads()
    {
        var f = new Fixture(); var before = JsonSerializer.Serialize(f.Document); var preview = await f.Create();
        Assert.NotNull(preview);
        Assert.Equal(0, f.Remote.Calls);
        Assert.Equal(PreviewDataSource.Fixture, (await preview.Data.GetStateAsync(f.Dataset, Viewer)).State!.Source);
        Assert.Equal(new NodeStringValue("fixture"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
        Assert.Equal(f.Empty, (await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Dataset, Viewer)).Evaluation!.EmptyViewNodeId);
        var result = await preview.Data.RefreshAsync(f.Dataset, Viewer);
        Assert.Equal("OK", result.Code);
        Assert.Equal("trusted", f.Remote.Connector);
        Assert.Equal(PreviewDataSource.Remote, result.State!.Source);
        Assert.Equal(new NodeStringValue("remote-private"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
        var repeated = (await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Dataset, Viewer)).Evaluation!;
        Assert.Equal(2, repeated.Items!.Count);
        Assert.Equal(new NodeStringValue("B"), repeated.Items[1][0].Value);
        Assert.Null(repeated.EmptyViewNodeId);
        Assert.Equal(before, JsonSerializer.Serialize(f.Document));
        Assert.DoesNotContain("remote-private", JsonSerializer.Serialize(preview));
        Assert.Equal("{}", JsonSerializer.Serialize(preview.Data));
        Assert.False(preview.Session.CanGoBack);
        Assert.Equal(f.Selection, preview.Session.Selection);
        Assert.Equal(PreviewDataSource.Fixture, (await (await f.Create()).Data.GetStateAsync(f.Dataset, Viewer)).State!.Source);
        Assert.Equal(1, f.Remote.Calls);
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Timeout));
        Assert.Equal("REMOTE_DATA_ERROR", (await preview.Data.RefreshAsync(f.Dataset, Viewer)).Code);
        Assert.Equal(new NodeStringValue("fixture"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
        Assert.Equal("OK", (await preview.Data.UseFixtureAsync(f.Dataset, Viewer)).Code);
        Assert.Equal(new NodeStringValue("fixture"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
    }

    [Fact]
    public async Task DataCapabilityDetachesTheRevisionDatasetAndBindingCollections()
    {
        var f = new Fixture(); var datasets = f.Document.Datasets.ToArray();
        var document = f.Document with { Datasets = datasets };
        var preview = (await new DocumentPreviewFactory(f.Auth, new Reader(document), f.Profile, f.Remote)
            .CreateAsync(document.Id, 7, f.Selection, Viewer)).Preview!;
        datasets[0] = datasets[0] with { FixtureJson = "{}", ConnectorId = "changed" };
        Assert.Equal(new NodeStringValue("fixture"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
        await preview.Data.RefreshAsync(f.Dataset, Viewer);
        Assert.Equal("trusted", f.Remote.Connector);
    }

    [Fact]
    public async Task LoadingFailureAndCancellationAreStructuredAndUseSavedFixture()
    {
        var f = new Fixture(); var preview = await f.Create();
        var completion = new TaskCompletionSource<RemoteJsonResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        f.Remote.Read = _ => completion.Task;
        var pending = preview.Data.RefreshAsync(f.Dataset, Viewer);
        Assert.Equal(PreviewDataStatus.Loading, (await preview.Data.GetStateAsync(f.Dataset, Viewer)).State!.Status);
        Assert.Equal("BUSY", (await preview.Data.RefreshAsync(f.Dataset, Viewer)).Code);
        Assert.Equal("BUSY", (await preview.Data.UseFixtureAsync(f.Dataset, Viewer)).Code);
        completion.SetResult(new(RemoteJsonStatus.Timeout));
        var failed = await pending;
        Assert.Equal("REMOTE_DATA_ERROR", failed.Code);
        Assert.Equal(PreviewDataStatus.Error, failed.State!.Status);
        Assert.Equal(RemoteJsonStatus.Timeout, failed.State.RemoteError);
        Assert.Equal(PreviewDataSource.Fixture, failed.State.Source);
        Assert.Equal(new NodeStringValue("fixture"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Value);
        await preview.Data.UseFixtureAsync(f.Dataset, Viewer);
        Assert.Null((await preview.Data.GetStateAsync(f.Dataset, Viewer)).State!.RemoteError);
        f.Remote.Read = _ => throw new InvalidOperationException("secret server address");
        Assert.Equal(RemoteJsonStatus.UpstreamFailure, (await preview.Data.RefreshAsync(f.Dataset, Viewer)).State!.RemoteError);
        f.Remote.Read = ct => Task.FromCanceled<RemoteJsonResult>(ct);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        Assert.Equal(RemoteJsonStatus.Cancelled, (await preview.Data.RefreshAsync(f.Dataset, Viewer, cancelled.Token)).State!.RemoteError);
        Assert.NotEqual(PreviewDataStatus.Loading, (await preview.Data.GetStateAsync(f.Dataset, Viewer)).State!.Status);
    }

    [Fact]
    public async Task EmptyAndInvalidDataAndRepeaterWorkLimitsArePreserved()
    {
        var f = new Fixture(); var preview = await f.Create();
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success, JsonSerializer.SerializeToElement(Array.Empty<object>())));
        Assert.Equal(PreviewDataStatus.Empty, (await preview.Data.RefreshAsync(f.Dataset, Viewer)).State!.Status);
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success,
            JsonSerializer.SerializeToElement(new { title = "empty", items = Array.Empty<object>() })));
        await preview.Data.RefreshAsync(f.Dataset, Viewer);
        Assert.Equal(f.Empty, (await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Dataset, Viewer)).Evaluation!.EmptyViewNodeId);
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success,
            JsonSerializer.SerializeToElement(new { title = 42, items = Enumerable.Range(0, 1001).Select(_ => new { name = "x" }) })));
        await preview.Data.RefreshAsync(f.Dataset, Viewer);
        Assert.Equal("DATA_INCOMPATIBLE_TYPE", (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Evaluation!.Diagnostic!.Code);
        Assert.Equal("DATA_REPEATER_LIMIT", (await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Dataset, Viewer)).Evaluation!.Diagnostic!.Code);
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success, JsonSerializer.SerializeToElement(new string('x', 65536))));
        Assert.Equal(RemoteJsonStatus.ResponseTooLarge, (await preview.Data.RefreshAsync(f.Dataset, Viewer)).State!.RemoteError);
        f.Remote.Read = _ => Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success));
        Assert.Equal(RemoteJsonStatus.InvalidJson, (await preview.Data.RefreshAsync(f.Dataset, Viewer)).State!.RemoteError);
    }

    [Fact]
    public async Task EveryOperationReauthorizesAndRevocationDiscardsInflightData()
    {
        var f = new Fixture(); var preview = await f.Create();
        f.Auth.Allowed = false;
        Assert.Equal("FORBIDDEN", (await preview.Data.GetStateAsync(f.Dataset, Viewer)).Code);
        Assert.Equal("FORBIDDEN", (await preview.Data.UseFixtureAsync(f.Dataset, Viewer)).Code);
        Assert.Equal("FORBIDDEN", (await preview.Data.RefreshAsync(f.Dataset, Viewer)).Code);
        Assert.Equal("FORBIDDEN", (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Dataset, Viewer)).Code);
        Assert.Equal("FORBIDDEN", (await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Dataset, Viewer)).Code);
        Assert.Equal(0, f.Remote.Calls);
        f.Auth.Allowed = true;
        f.Remote.Read = _ => { f.Auth.Allowed = false; return Task.FromResult(new RemoteJsonResult(RemoteJsonStatus.Success, JsonSerializer.SerializeToElement("private"))); };
        Assert.Equal("FORBIDDEN", (await preview.Data.RefreshAsync(f.Dataset, Viewer)).Code);
        f.Auth.Allowed = true;
        Assert.Equal(PreviewDataSource.Fixture, (await preview.Data.GetStateAsync(f.Dataset, Viewer)).State!.Source);
    }

    [Fact]
    public async Task DatasetAxisIsIndependentAndOrdinaryQueriesAndDurableStateNeverFetch()
    {
        var f = new Fixture(); var directory = Path.Combine(Path.GetTempPath(), "figvam-remote-preview-" + Guid.NewGuid());
        try
        {
            var journal = new SqliteDocumentJournal(directory, f.Profile);
            await journal.InitializeAsync(f.Document);
            var factory = new DocumentPreviewFactory(f.Auth, journal, f.Profile, f.Remote);
            var preview = (await factory.CreateAsync(f.Document.Id, 0, f.Selection, Viewer)).Preview!;
            Assert.Equal(new NodeStringValue("alternative"), (await preview.Data.EvaluateBindingAsync(f.Owner, "text", f.Alternative, Viewer)).Evaluation!.Value);
            Assert.Single((await preview.Data.EvaluateRepeaterAsync(f.Owner, f.Alternative, Viewer)).Evaluation!.Items!);
            Assert.Equal(f.Selection, preview.Session.Selection);
            Assert.Equal("CONNECTOR_NOT_CONFIGURED", (await preview.Data.RefreshAsync(f.Alternative, Viewer)).Code);
            await new DocumentRepeaterQueries(f.Auth, journal, f.Profile).EvaluateAsync(f.Document.Id, f.Owner, 0, 0, 10, Viewer);
            var queries = new DocumentDatasetQueries(f.Auth, journal);
            Assert.Equal(f.Document.Datasets[0].FixtureJson, (await queries.ReadFixtureAsync(f.Document.Id, f.Dataset, 0, Viewer)).Response!.FixtureJson);
            Assert.Empty((await new DocumentRevisionDiff(f.Auth, journal).CompareAsync(f.Document.Id, 0, 0, 0, 10, Viewer)).Response!.Items);
            Assert.Equal(0, f.Remote.Calls);
            var before = JsonSerializer.Serialize((await journal.ReadAsync(f.Document.Id))!);
            await preview.Data.RefreshAsync(f.Dataset, Viewer);
            Assert.Equal(before, JsonSerializer.Serialize((await journal.ReadAsync(f.Document.Id))!));
            var recovered = new SqliteDocumentJournal(directory, f.Profile);
            Assert.Equal(before, JsonSerializer.Serialize((await recovered.ReadAsync(f.Document.Id))!));
            Assert.DoesNotContain("remote-private", JsonSerializer.Serialize((await ((IDocumentStateReader)recovered).ReadAsync(f.Document.Id, 0)).State));
            Assert.Equal(f.Document.Datasets[0].FixtureJson, (await queries.ReadFixtureAsync(f.Document.Id, f.Dataset, 0, Viewer)).Response!.FixtureJson);
            Assert.Empty((await new DocumentRevisionDiff(f.Auth, journal).CompareAsync(f.Document.Id, 0, 0, 0, 10, Viewer)).Response!.Items);
            Assert.Equal(1, f.Remote.Calls);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
