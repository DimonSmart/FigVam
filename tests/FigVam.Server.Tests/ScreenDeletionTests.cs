using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class ScreenDeletionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-screen-delete-" + Guid.NewGuid());
    private readonly Guid doc = Guid.NewGuid(), page = Guid.NewGuid(), screen = Guid.NewGuid(), root = Guid.NewGuid(), child = Guid.NewGuid();
    private readonly DocumentActor owner = new("owner"), editor = new("editor");
    private sealed class Access : IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id != "outsider");
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(actor.Id is "owner" or "editor");
    }
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool SupportsPreviewEvent(string kind, PreviewEvent e) => true;
        public bool SupportsPreviewAction(PreviewAction action) => true;
        public bool SupportsDemoValue(string kind) => true;
    }
    private SqliteDocumentJournal Journal() => new(directory, new Profile());
    private DocumentCommandHandler Handler() => new(new Access(), Journal(), new Profile());
    private DocumentStructure Initial() => new(doc, [new(page, [screen]) { Name = "Design" }],
        [new(screen, [root], new(320, 480)) { Variants = [new(Guid.NewGuid(), "Alternate", [])] }],
        [new(root, "test", [child]), new(child, "test", [])]);
    private DeleteScreenCommand Delete(long revision = 0) => new(doc, Guid.NewGuid(), screen, revision);
    private async Task<string> Current() => JsonSerializer.Serialize(await Journal().ReadAsync(doc));

    [Fact]
    public async Task DeleteLastScreenRecoversEventsAndSupportsUndoRedo()
    {
        var initial = Initial();
        await Journal().InitializeAsync(initial);
        var command = Delete();
        var result = await Handler().HandleAsync(command, owner);
        Assert.True(result.Accepted);
        Assert.Equal(result, await Handler().HandleAsync(command with { ScreenId = Guid.Empty }, owner));
        var current = (await Journal().ReadAsync(doc))!;
        Assert.Equal(1, current.Revision);
        Assert.Empty(Assert.Single(current.Document.Pages).ScreenIds);
        Assert.Empty(current.Document.Screens);
        Assert.Empty(current.Document.Nodes);
        var change = Assert.Single((await Journal().ReadEventsAsync(doc, 0)).Events!);
        Assert.IsType<ScreenDeleted>(change.Payload);
        Assert.Equal("DELETE_SCREEN", change.Type);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(initial), JsonSerializer.Serialize((await Journal().ReadAsync(doc))!.Document));
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
        Assert.Empty((await Journal().ReadAsync(doc))!.Document.Screens);
    }

    [Theory]
    [InlineData("page")]
    [InlineData("scenario")]
    [InlineData("component")]
    public async Task RetainedReferencesBlockDeletion(string reference)
    {
        var document = Initial();
        document = reference switch
        {
            "page" => document with { Pages = [.. document.Pages, new(Guid.NewGuid(), [screen])] },
            "scenario" => document with { Scenarios = [new(Guid.NewGuid(), screen, child, PreviewEvent.Click, [new Navigate(screen)])] },
            _ => document with { ComponentDefinitions = [new(Guid.NewGuid(), "Component", "", root, [], [], [])] }
        };
        await Journal().InitializeAsync(document);
        var before = await Current();
        var result = await Handler().HandleAsync(Delete(), owner);
        Assert.Equal("SCREEN_IN_USE", result.Code);
        Assert.NotEmpty(result.Explanation!);
        Assert.Equal(before, await Current());
        Assert.Empty((await Journal().ReadEventsAsync(doc, 0)).Events!);
    }

    [Fact]
    public async Task RejectsUnauthorizedAndStaleWritesWithoutMutation()
    {
        await Journal().InitializeAsync(Initial());
        var before = await Current();
        Assert.Equal("FORBIDDEN", (await Handler().HandleAsync(Delete(), new("viewer"))).Code);
        Assert.Equal("REVISION_CONFLICT", (await Handler().HandleAsync(Delete(1), owner)).Code);
        Assert.Equal("SCREEN_NOT_FOUND", (await Handler().HandleAsync(Delete() with { ScreenId = Guid.NewGuid() }, editor)).Code);
        Assert.Equal(before, await Current());
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
