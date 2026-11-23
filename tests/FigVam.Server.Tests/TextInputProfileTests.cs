using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public sealed class TextInputProfileTests
{
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
            Profile = PortableUiProfileReference.Current
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

}
