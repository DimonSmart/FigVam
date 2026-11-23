using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class PortableUiV3Tests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-profile-v3-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner");

    [Fact]
    public async Task Version2RetainsItsSemanticsUntilExplicitReversibleVersion3Upgrade()
    {
        var profile = new VisualNodeProfile();
        var legacy = profile.GetInstalledVersion(2)!;
        var id = Guid.NewGuid();
        var source = new SqliteDocumentJournal(directory, legacy);
        Assert.True((await source.CreateAsync(new(id), owner)).Accepted);
        var v2State = (await source.ReadAsync(id))!;
        Assert.Equal(PortableUiProfileReference.Version2, v2State.Document.Profile);
        Assert.Null(legacy.GetProperty("TextInput", "inputType"));
        Assert.False(legacy.SupportsPreviewEvent("TextInput", PreviewEvent.Submit));

        var journal = new SqliteDocumentJournal(directory, profile);
        var handler = new DocumentCommandHandler(journal, journal, profile);
        var upgrade = new UpgradePortableUiProfileCommand(id, Guid.NewGuid(), v2State.Revision);
        Assert.True((await handler.HandleAsync(upgrade, owner)).Accepted);
        Assert.Equal(PortableUiProfileReference.Version3, (await journal.ReadAsync(id))!.Document.Profile);
        Assert.Equal("REVISION_CONFLICT", (await handler.HandleAsync(upgrade with
        {
            CommandId = Guid.NewGuid(), ExpectedRevision = v2State.Revision + 2
        }, owner)).Code);
        var upgradeToV4 = upgrade with { CommandId = Guid.NewGuid(), ExpectedRevision = v2State.Revision + 1 };
        Assert.True((await handler.HandleAsync(upgradeToV4, owner)).Accepted);
        Assert.Equal(PortableUiProfileReference.Version4, (await journal.ReadAsync(id))!.Document.Profile);
        Assert.Equal("PROFILE_UPGRADE_NOT_APPLICABLE", (await handler.HandleAsync(upgrade with
        {
            CommandId = Guid.NewGuid(), ExpectedRevision = v2State.Revision + 2
        }, owner)).Code);
        Assert.Equal(new NodeEnumValue("Text"), profile.GetProperty("TextInput", "inputType")!.DefaultValue);
        Assert.True(profile.SupportsPreviewEvent("TextInput", PreviewEvent.Submit));

        Assert.True((await handler.HandleAsync(new UndoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
        Assert.Equal(PortableUiProfileReference.Version3, (await journal.ReadAsync(id))!.Document.Profile);
        Assert.True((await handler.HandleAsync(new RedoDocumentCommand(id, Guid.NewGuid()), owner)).Accepted);
        var reopened = new SqliteDocumentJournal(directory, new VisualNodeProfile());
        Assert.Equal(PortableUiProfileReference.Version4, (await reopened.ReadAsync(id))!.Document.Profile);
        Assert.Equal(PortableUiProfileReference.Version2, (await reopened.ReadAsync(id, v2State.Revision)).State!.Document.Profile);
    }

    [Fact]
    public void PasswordMultilineCombinationIsRejectedInBaseAndVariants()
    {
        var profile = new VisualNodeProfile();
        var id = Guid.NewGuid();
        var nodeId = Guid.NewGuid();
        var screenId = Guid.NewGuid();
        var variantId = Guid.NewGuid();
        var node = new NodeStructure(nodeId, "TextInput", []) { Properties =
            System.Collections.Immutable.ImmutableSortedDictionary<string, NodePropertyValue>.Empty
                .Add("inputType", new NodeEnumValue("Password"))
                .Add("multiline", new NodeBooleanValue(true)) };
        var screen = new ScreenStructure(screenId, [nodeId], new(640, 480))
        {
            Variants = [new ScreenVariant(variantId, "Error", [])]
        };
        var document = new DocumentStructure(id, [new(Guid.NewGuid(), [screenId])], [screen], [node])
        {
            Profile = PortableUiProfileReference.Version3
        };
        Assert.Contains(DocumentStructureValidator.Validate(document, profile),
            error => error.Code == "INVALID_PROPERTY_VALUE" && error.ObjectId == nodeId && error.Property == "inputType");

        node = node with { Properties = node.Properties.SetItem("multiline", new NodeBooleanValue(false)) };
        screen = screen with { Variants = [new ScreenVariant(variantId, "Error",
            [new ScreenPropertyOverride(nodeId, "multiline", new NodeBooleanValue(true))])] };
        document = document with { Nodes = [node], Screens = [screen] };
        Assert.Contains(DocumentStructureValidator.Validate(document, profile),
            error => error.Code == "INVALID_PROPERTY_VALUE" && error.ObjectId == variantId && error.Property == "inputType");
    }

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }
}
