using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;
using FigVam.Server.Documents;

namespace FigVam.Server.Tests;

public sealed class ScreenDimensionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-screen-size-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), page = Guid.NewGuid(), screen = Guid.NewGuid();
    private readonly DocumentActor alice = new("alice"), bob = new("bob");
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "alice" or "bob");
    }
    private SqliteDocumentJournal Journal() => new(directory, new EmptyNodeProfile());
    private DocumentCommandHandler Handler() => new(new Access(), Journal(), new EmptyNodeProfile());
    private async Task Seed()
    {
        await Journal().InitializeAsync(new(doc, [], [], []));
        Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), page), alice)).Accepted);
    }
    private async Task Create(ScreenDimensions? dimensions = null)
        => Assert.True((await Handler().HandleAsync(new AddScreenCommand(doc, Guid.NewGuid(), page, screen, dimensions ?? new(320, 480)), alice)).Accepted);
    private async Task<ScreenDimensions> Current() => Assert.Single((await Journal().ReadAsync(doc))!.Document.Screens).Dimensions;

    [Fact]
    public async Task ValidationAuthorizationAndIdempotencyLeaveRejectedStateUnchanged()
    {
        await Seed();
        foreach (var dimensions in new ScreenDimensions[] { new(-1, 10), new(10, -1), new(double.NaN, 10), new(10, double.PositiveInfinity), new(double.NegativeInfinity, 0), null! })
            Assert.Equal("INVALID_SCREEN_DIMENSIONS", (await Handler().HandleAsync(new AddScreenCommand(doc, Guid.NewGuid(), page, screen, dimensions), alice)).Code);
        Assert.Equal(1, (await Journal().ReadAsync(doc))!.Revision);
        var create = new AddScreenCommand(doc, Guid.NewGuid(), page, screen, new(0, 0));
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(create, new("viewer"))).Code);
        var first = await Handler().HandleAsync(create, alice);
        Assert.True(first.Accepted);
        Assert.Equal(first, await Handler().HandleAsync(create with { Dimensions = new(-1, 5) }, alice));
        var resize = new ResizeScreenCommand(doc, Guid.NewGuid(), screen, new(800.25, 600.5));
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(resize, new("viewer"))).Code);
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(resize, new("outsider"))).Code);
        Assert.Equal("SCREEN_NOT_FOUND", (await Handler().HandleAsync(resize with { CommandId = Guid.NewGuid(), ScreenId = Guid.NewGuid() }, alice)).Code);
        Assert.Equal("INVALID_ID", (await Handler().HandleAsync(resize with { ScreenId = Guid.Empty }, alice)).Code);
        foreach (var dimensions in new ScreenDimensions[] { new(-1, 0), new(0, -1), new(double.NaN, 1), new(1, double.PositiveInfinity), null! })
            Assert.Equal("INVALID_SCREEN_DIMENSIONS", (await Handler().HandleAsync(resize with { CommandId = Guid.NewGuid(), Dimensions = dimensions }, alice)).Code);
        var invalidResize = resize with { CommandId = Guid.NewGuid(), Dimensions = new(-1, 0) };
        var denial = await Handler().HandleAsync(invalidResize, alice);
        Assert.Equal("INVALID_SCREEN_DIMENSIONS", denial.Code);
        Assert.Equal(denial, await Handler().HandleAsync(invalidResize with { Dimensions = new(1, 1) }, alice));
        Assert.Equal(2, (await Journal().ReadAsync(doc))!.Revision);
        var accepted = await Handler().HandleAsync(resize, alice);
        Assert.True(accepted.Accepted);
        Assert.Equal(accepted, await Handler().HandleAsync(resize with { Dimensions = new(1, 1) }, alice));
        Assert.Equal(resize.Dimensions, await Current());
        Assert.Equal(3, (await Journal().ReadAsync(doc))!.Revision);
        var invalid = (await Journal().ReadAsync(doc))!.Document with { Screens = [new(screen, [], new(-1, 0))] };
        Assert.Contains(DocumentStructureValidator.Validate(invalid, new EmptyNodeProfile()), e => e.Code == "INVALID_SCREEN_DIMENSIONS");
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ScreenStructure>($"{{\"Id\":\"{screen}\",\"ChildIds\":[],\"Variants\":[]}}"));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ScreenDimensions>("{\"Width\":0}"));
    }

    [Fact]
    public async Task RevisionReadsEventsHistorySavedVersionsAndRecoveryPreserveDimensions()
    {
        await Seed(); await Create();
        var resize = new ResizeScreenCommand(doc, Guid.NewGuid(), screen, new(1024, 768));
        Assert.True((await Handler().HandleAsync(resize, alice)).Accepted);
        var queries = new DocumentStructureQueries(new Access(), Journal(), new EmptyNodeProfile());
        Assert.Equal(new(320, 480), Assert.Single((await queries.QueryAsync(doc, new("screen", screen, Revision: 2), new("viewer"))).Response!.Items).Dimensions);
        Assert.Equal(resize.Dimensions, Assert.Single((await queries.QueryAsync(doc, new("screens", Fields: "dimensions"), alice)).Response!.Items).Dimensions);
        Assert.Null(Assert.Single((await queries.QueryAsync(doc, new("screens", Fields: "childCount"), alice)).Response!.Items).Dimensions);
        Assert.Equal("FORBIDDEN", (await queries.QueryAsync(doc, new("screens", Revision: 2), new("outsider"))).Code);
        var diff = await new DocumentRevisionDiff(new Access(), Journal()).CompareAsync(doc, 2, 3, 0, 100, alice);
        Assert.Equal(new[] { "dimensions.height", "dimensions.width" }, Assert.Single(diff.Response!.Items).ChangedProperties);
        var events = (await new DocumentReconnectReader(new Access(), Journal()).ReadAsync(doc, 1, alice)).Events!;
        Assert.Equal(new(320, 480), Assert.IsType<ScreenAdded>(events[0].Payload).Dimensions);
        Assert.Equal(resize.Dimensions, Assert.IsType<ScreenResized>(events[1].Payload).Dimensions);
        Assert.Equal(resize.CommandId, events[1].CommandId); Assert.Equal("alice", events[1].ActorId);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), alice)).Accepted);
        Assert.Equal(new(320, 480), await Current());
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), alice)).Accepted);
        Assert.Equal(resize.Dimensions, await Current());
        var saved = await Handler().HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid()), alice);
        Assert.True((await Handler().HandleAsync(resize with { CommandId = Guid.NewGuid(), Dimensions = new(0, 0) }, alice)).Accepted);
        Assert.True((await Handler().HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), saved.VersionId!.Value), alice)).Accepted);
        Assert.Equal(resize.Dimensions, await Current());
        // Cross the periodic snapshot boundary, then recover both historical and latest sizes with a fresh journal.
        for (var i = 0; i < 35; i++) Assert.True((await Handler().HandleAsync(resize with { CommandId = Guid.NewGuid(), Dimensions = new(i, i + 1) }, alice)).Accepted);
        Assert.Equal(new(34, 35), await Current());
        Assert.Equal(new(320, 480), Assert.Single((await Journal().ReadAsync(doc, 2)).State!.Document.Screens).Dimensions);
        Assert.Equal(resize.Dimensions, Assert.Single((await Journal().ReadAsync(doc, 3)).State!.Document.Screens).Dimensions);
    }

    [Fact]
    public async Task UndoNeverOverwritesAnotherActorsResizeAndCreationHistoryIsReversible()
    {
        await Seed(); await Create();
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), alice)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Screens);
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), alice)).Accepted);
        Assert.Equal(new(320, 480), await Current());
        Assert.True((await Handler().HandleAsync(new ResizeScreenCommand(doc, Guid.NewGuid(), screen, new(640, 480)), alice)).Accepted);
        Assert.True((await Handler().HandleAsync(new ResizeScreenCommand(doc, Guid.NewGuid(), screen, new(900, 700)), bob)).Accepted);
        Assert.Equal("UNDO_NOT_APPLICABLE", (await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), alice)).Code);
        Assert.Equal(new(900, 700), await Current());
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), bob)).Accepted);
        Assert.Equal(new(640, 480), await Current());
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), alice)).Accepted);
        Assert.Equal(new(320, 480), await Current());
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
