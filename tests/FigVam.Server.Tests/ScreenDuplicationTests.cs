using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class ScreenDuplicationTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-duplicate-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner");

    [Fact]
    public async Task CopyIsAtomicIndependentReplayableIdempotentAndUndoable()
    {
        var profile = new VisualNodeProfile();
        var journal = new SqliteDocumentJournal(directory, profile);
        var handler = new DocumentCommandHandler(journal, journal, profile);
        var documentId = Guid.NewGuid();
        var pageId = Guid.NewGuid();
        var loginId = Guid.NewGuid();
        var frameId = Guid.NewGuid();
        var inputId = Guid.NewGuid();
        var variantId = Guid.NewGuid();
        var copyId = Guid.NewGuid();

        Assert.True((await journal.CreateAsync(new(documentId), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), pageId), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddScreenCommand(documentId, Guid.NewGuid(), pageId, loginId, new(800, 600)), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new RenameScreenCommand(documentId, Guid.NewGuid(), loginId, "Login"), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), loginId, frameId, "Frame"), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), frameId, inputId, "TextInput"), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new SetNodePropertyCommand(documentId, Guid.NewGuid(), inputId,
            "inputType", new NodeEnumValue("Password")), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new AddScreenVariantCommand(documentId, Guid.NewGuid(), loginId, variantId,
            "InvalidPassword"), owner)).Accepted);
        Assert.True((await handler.HandleAsync(new SetScreenVariantOverrideCommand(documentId, Guid.NewGuid(), loginId,
            variantId, inputId, "placeholder", new NodeStringValue("Try again")), owner)).Accepted);

        var shadow = new NodeShadowValue(0, 12, 32, 0, new(15, 23, 42, 41));
        Assert.True((await handler.HandleAsync(new SetNodePropertyCommand(documentId, Guid.NewGuid(), frameId, "shadow", shadow), owner)).Accepted);
        var before = (await journal.ReadAsync(documentId))!;
        var command = new DuplicateScreenCommand(documentId, Guid.NewGuid(), loginId, copyId, before.Revision);
        var accepted = await handler.HandleAsync(command, owner);
        Assert.True(accepted.Accepted, accepted.Code);
        Assert.Equal(accepted, await handler.HandleAsync(command, owner));
        Assert.Equal("REVISION_CONFLICT", (await handler.HandleAsync(command with { CommandId = Guid.NewGuid(),
            ExpectedRevision = before.Revision - 1 }, owner)).Code);

        var after = (await journal.ReadAsync(documentId))!;
        Assert.Equal(before.Revision + 1, after.Revision);
        Assert.Equal(new[] { loginId, copyId }, Assert.Single(after.Document.Pages).ScreenIds);
        var original = after.Document.Screens.Single(s => s.Id == loginId);
        var copied = after.Document.Screens.Single(s => s.Id == copyId);
        Assert.Equal("Login (copy)", copied.Name);
        Assert.Equal(original.Dimensions, copied.Dimensions);
        Assert.DoesNotContain(copied.ChildIds[0], original.ChildIds);
        var clonedFrame = after.Document.Nodes.Single(n => n.Id == copied.ChildIds.Single());
        var clonedInput = after.Document.Nodes.Single(n => n.Id == clonedFrame.ChildIds.Single());
        Assert.Equal(shadow, clonedFrame.Properties["shadow"]);
        Assert.NotEqual(inputId, clonedInput.Id);
        Assert.Equal("TextInput", clonedInput.Kind);
        Assert.Equal(new NodeEnumValue("Password"), clonedInput.Properties["inputType"]);
        var copiedVariant = Assert.Single(copied.Variants);
        Assert.NotEqual(variantId, copiedVariant.Id);
        Assert.Equal(clonedInput.Id, Assert.Single(copiedVariant.Overrides).NodeId);
        Assert.Equal(new NodeStringValue("Try again"), copiedVariant.Overrides[0].Value);
        Assert.Equal(variantId, Assert.Single(original.Variants).Id);

        Assert.True((await handler.HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), owner)).Accepted);
        Assert.Single((await journal.ReadAsync(documentId))!.Document.Screens);
        Assert.True((await handler.HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(copyId, (await journal.ReadAsync(documentId))!.Document.Screens.Last().Id);

        var reopened = new SqliteDocumentJournal(directory, new VisualNodeProfile());
        var restored = (await reopened.ReadAsync(documentId))!;
        Assert.Equal(copyId, restored.Document.Screens.Last().Id);
        Assert.Equal(clonedInput.Id, restored.Document.Nodes.Single(n => n.Id == clonedInput.Id).Id);
        Assert.Equal(variantId, Assert.Single(restored.Document.Screens.First().Variants).Id);
    }

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }
}
