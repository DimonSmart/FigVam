using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class VisualNodeProfileTests : IDisposable
{
    private readonly VisualNodeProfile profile = new();
    private readonly string directory = Path.Combine(Path.GetTempPath(), "figvam-visual-profile-" + Guid.NewGuid());
    private readonly DocumentActor owner = new("owner");

    [Theory]
    [InlineData("Frame", NodeSemanticRole.Container, true, null)]
    [InlineData("Text", NodeSemanticRole.Text, false, null)]
    [InlineData("Button", NodeSemanticRole.Button, false, PreviewEvent.Click)]
    [InlineData("TextInput", NodeSemanticRole.TextInput, false, PreviewEvent.Change)]
    [InlineData("Image", NodeSemanticRole.Image, false, null)]
    public void RegistryDescribesEachKindAndItsEffectiveDefaults(string kind, NodeSemanticRole role, bool children, PreviewEvent? previewEvent)
    {
        Assert.Equal(5, profile.Kinds.Count);
        var definition = Assert.Single(profile.Kinds, item => item.Kind == kind);
        Assert.Equal(role, definition.SemanticRole);
        Assert.Equal(children, profile.CanContainChildren(kind));
        Assert.Equal(kind == "TextInput" ? [PreviewEvent.Change, PreviewEvent.Submit] :
            previewEvent is { } enabled ? [enabled] : Array.Empty<PreviewEvent>(), definition.PreviewEvents);
        Assert.Equal(kind == "TextInput", profile.SupportsDemoValue(kind));
        foreach (var (property, metadata) in definition.Properties)
        {
            Assert.Same(metadata, profile.GetProperty(kind, property));
            if (metadata.Required)
                Assert.Null(metadata.DefaultValue);
            else if (metadata.DefaultValue is { } value)
                Assert.Null(NodePropertyValidator.Validate(profile, kind, property, value));
            // Optional references deliberately have no default: an unassigned style must not
            // silently resolve to a fabricated global style.
        }
        Assert.True(profile.SupportsPreviewAction(new Navigate(Guid.NewGuid())));
        Assert.Contains("navigate", profile.PreviewActions);
        Assert.False(profile.IsKnownKind(kind.ToLowerInvariant()));
        Assert.Equal("UNSUPPORTED_PROPERTY", NodePropertyValidator.Validate(profile, kind, "style", new NodeStringValue("width: 1px"))!.Code);
    }

    [Fact]
    public void ValidatesTypedValuesAndDocumentReferences()
    {
        void Valid(string kind, string property, NodePropertyValue value) =>
            Assert.Null(NodePropertyValidator.Validate(profile, kind, property, value));
        void Invalid(string code, string kind, string property, NodePropertyValue value) =>
            Assert.Equal(code, NodePropertyValidator.Validate(profile, kind, property, value)!.Code);

        Valid("Frame", "x", new NodeNumberValue(-20));
        Valid("Frame", "layout", new NodeEnumValue("Horizontal"));
        Valid("Text", "text", new NodeStringValue("<strong>Literal text</strong>"));
        Valid("Text", "fontFamily", new NodeStringValue("IBM Plex Sans"));
        Valid("Button", "enabled", new NodeBooleanValue(false));
        Valid("TextInput", "multiline", new NodeBooleanValue(true));
        Valid("TextInput", "inputType", new NodeEnumValue("Password"));
        Invalid("INVALID_PROPERTY_VALUE", "TextInput", "inputType", new NodeEnumValue("Email"));
        Valid("Image", "fit", new NodeEnumValue("Cover"));
        Invalid("INVALID_PROPERTY_VALUE", "Frame", "width", new NodeNumberValue(-1));
        Invalid("INVALID_PROPERTY_VALUE", "Frame", "gap", new NodeNumberValue(double.NaN));
        Invalid("INVALID_PROPERTY_VALUE", "Frame", "heightMode", new NodeEnumValue("Fill"));
        Invalid("INVALID_PROPERTY_VALUE", "Text", "fontFamily", new NodeStringValue("arial;display:none"));
        Invalid("INVALID_PROPERTY_VALUE", "Text", "fontFamily", new NodeStringValue("Arial\n"));
        Invalid("INVALID_PROPERTY_TYPE", "Button", "enabled", new NodeStringValue("yes"));
        Invalid("INVALID_PROPERTY_VALUE", "TextInput", "value", new NodeStringValue(new string('a', 4097)));
        Invalid("INVALID_PROPERTY_VALUE", "Image", "fit", new NodeEnumValue("tile"));
        Invalid("INVALID_PROPERTY_TYPE", "Frame", "backgroundColor", new NodeStringValue("red"));
        Invalid("UNSUPPORTED_PROPERTY", "Text", "href", new NodeStringValue("https://example.org"));

        var color = new NodeColorValue(16, 100, 210, 160);
        var asset = new DocumentAsset(Guid.NewGuid(), "image/png", new string('0', 64), 32, 1, 1);
        var colorToken = Token(TokenType.Color, new ColorValue(0, 20, 40));
        var spacingToken = Token(TokenType.Spacing, new SpacingValue(8));
        var frame = new NodeStructure(Guid.NewGuid(), "Frame", []);
        var text = new NodeStructure(Guid.NewGuid(), "Text", []);
        var image = new NodeStructure(Guid.NewGuid(), "Image", []);
        frame = frame with { ChildIds = [text.Id, image.Id], Properties = frame.Properties.Add("backgroundColor", color) };
        text = text with { Properties = text.Properties.Add("textColor", new NodeTokenValue(colorToken.Id)) };
        image = image with { Properties = image.Properties.Add("asset", new NodeAssetValue(asset.Id)) };
        var screen = new ScreenStructure(Guid.NewGuid(), [frame.Id], new(800, 600));
        var document = new DocumentStructure(Guid.NewGuid(), [new(Guid.NewGuid(), [screen.Id])], [screen], [frame, text, image])
        {
            Profile = PortableUiProfileReference.Current,
            Assets = [asset],
            Tokens = [colorToken, spacingToken]
        };

        Assert.Empty(DocumentStructureValidator.Validate(document, profile));
        void Diagnose(DocumentStructure invalid, string code, Guid id, string? property)
        {
            Assert.Contains(DocumentStructureValidator.Validate(invalid, profile),
                error => error.Code == code && error.ObjectId == id && error.Property == property);
        }
        Diagnose(document with { Tokens = [spacingToken] }, "missing-reference", text.Id, "textColor");
        Diagnose(document with { Nodes = [frame, text with { Properties = text.Properties.SetItem("textColor", new NodeTokenValue(spacingToken.Id)) }, image] },
            "type-mismatch", text.Id, "textColor");
        Diagnose(document with { Assets = [] }, "missing-reference", image.Id, "asset");
        Diagnose(document with { Nodes = [frame, text, image with { Properties = image.Properties.Clear() }] },
            "REQUIRED_PROPERTY", image.Id, "asset");
        Diagnose(document with { Nodes = [frame with { ChildIds = [text.Id] }, text with { ChildIds = [image.Id] }, image] },
            "children-not-allowed", text.Id, null);
        Diagnose(document with { Nodes = [frame with { Kind = "HTMLElement" }, text, image] }, "unknown-node-kind", frame.Id, null);
        Assert.Equal(color, JsonSerializer.Deserialize<NodePropertyValue>(JsonSerializer.Serialize<NodePropertyValue>(color)));
    }

    [Fact]
    public void FrameSpacingPropertiesUseCategorizedDimensionTokens()
    {
        var properties = Assert.Single(profile.Kinds, kind => kind.Kind == "Frame").Properties;
        var spacing = properties.Where(item => item.Value.TokenType == TokenType.Dimension &&
            item.Value.TokenCategory == TokenCategory.Spacing).ToArray();
        Assert.Equal(new[] { "gap", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop" },
            spacing.Select(item => item.Key).Order());
        var token = new NodeTokenValue(Guid.NewGuid());
        foreach (var (name, definition) in spacing)
        {
            Assert.Equal(NodePropertyType.Number, definition.Type);
            Assert.Equal(TokenType.Spacing, definition.LegacyTokenType);
            Assert.Null(NodePropertyValidator.Validate(profile, "Frame", name, new NodeNumberValue(0)));
            Assert.Null(NodePropertyValidator.Validate(profile, "Frame", name, token));
            Assert.Equal("INVALID_PROPERTY_VALUE", NodePropertyValidator.Validate(profile, "Frame", name, new NodeTokenValue(Guid.Empty))!.Code);
        }
        Assert.Null(NodePropertyValidator.Validate(profile, "Frame", "width", token));
        Assert.Null(NodePropertyValidator.Validate(profile, "Frame", "cornerRadius", token));
        Assert.Equal("INVALID_PROPERTY_TYPE", NodePropertyValidator.Validate(profile, "Frame", "x", token)!.Code);
    }

    [Fact]
    public async Task PersistsAllKindsWithOrderedChildIdsAndImageContent()
    {
        var content = DocumentAssetTests.Png();
        var asset = SafeRasterImage.Inspect(Guid.NewGuid(), "image/png", content)!;
        var children = new[] { "Text", "Button", "TextInput", "Image" }
            .Select(kind => new NodeStructure(Guid.NewGuid(), kind, [])).ToArray();
        var image = children[^1];
        children[^1] = image with { Properties = image.Properties.Add("asset", new NodeAssetValue(asset.Id)) };
        var frame = new NodeStructure(Guid.NewGuid(), "Frame", children.Select(node => node.Id).ToArray());
        var screen = new ScreenStructure(Guid.NewGuid(), [frame.Id], new(800, 600));
        var document = new DocumentStructure(Guid.NewGuid(), [new(Guid.NewGuid(), [screen.Id])], [screen], [frame, .. children])
        {
            Profile = profile.Identity,
            Assets = [asset]
        };
        var journal = new SqliteDocumentJournal(directory, profile);
        Assert.Equal("ACCEPTED", (await journal.CreateImportedAsync(document, [new(asset, content)], owner)).Code);
        var saved = await new DocumentCommandHandler(journal, journal, profile)
            .HandleAsync(new SaveDocumentCommand(document.Id, Guid.NewGuid(), "All kinds"), owner);
        Assert.True(saved.Accepted);

        var reopened = new SqliteDocumentJournal(directory, new VisualNodeProfile());
        var snapshot = (await reopened.ReadVersionAsync(document.Id, saved.VersionId!.Value)).Version!.Snapshot;
        Assert.Equal(document.Nodes.Select(node => (node.Id, node.Kind)), snapshot.Document.Nodes.Select(node => (node.Id, node.Kind)));
        Assert.Equal(frame.ChildIds, snapshot.Document.Nodes[0].ChildIds);
        Assert.Equal(new NodeAssetValue(asset.Id), snapshot.Document.Nodes[^1].Properties["asset"]);
        Assert.Equal(content, (await new DocumentAssets(reopened, reopened, reopened, reopened)
            .ReadAsync(document.Id, asset.Id, owner, versionId: saved.VersionId)).Content!.Content);
    }

    [Theory]
    [InlineData("Frame")]
    [InlineData("Button")]
    [InlineData("TextInput")]
    [InlineData("Image")]
    public void ShadowIsOptionalAndTyped(string kind)
    {
        var definition = profile.GetProperty(kind, "shadow")!;
        Assert.Equal(NodePropertyType.Shadow, definition.Type);
        Assert.False(definition.Required);
        Assert.Null(definition.DefaultValue);
        Assert.Null(definition.TokenType);
        var shadow = new NodeShadowValue(-3, 12, 32, -2, new(15, 23, 42, 41));
        Assert.Null(NodePropertyValidator.Validate(profile, kind, "shadow", shadow));
        Assert.Equal(shadow, JsonSerializer.Deserialize<NodePropertyValue>(JsonSerializer.Serialize<NodePropertyValue>(shadow)));
        Assert.Equal("UNSUPPORTED_PROPERTY", NodePropertyValidator.Validate(profile, "Text", "shadow", shadow)!.Code);
        Assert.Equal("INVALID_PROPERTY_TYPE", NodePropertyValidator.Validate(profile, kind, "shadow", new NodeStringValue("shadow"))!.Code);
        Assert.Equal("INVALID_PROPERTY_TYPE", NodePropertyValidator.Validate(profile, kind, "shadow", new NodeTokenValue(Guid.NewGuid()))!.Code);
        foreach (var invalid in new[] { shadow with { BlurRadius = -1 }, shadow with { BlurRadius = 257 },
            shadow with { OffsetX = double.NaN }, shadow with { OffsetY = double.PositiveInfinity },
            shadow with { SpreadRadius = double.NegativeInfinity }, shadow with { OffsetX = 1025 },
            shadow with { SpreadRadius = -257 }, shadow with { Color = null! } })
            Assert.Equal("INVALID_PROPERTY_VALUE", NodePropertyValidator.Validate(profile, kind, "shadow", invalid)!.Code);
    }

    [Fact]
    public void ShadowJsonRequiresAllFieldsAndRejectsUnknownMembers()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var shadow = new NodeShadowValue(0, 4, 8, 0, new(0, 0, 0, 38));
        var json = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize<NodePropertyValue>(shadow, options))!.AsObject();
        foreach (var name in new[] { "offsetX", "offsetY", "blurRadius", "spreadRadius", "color" })
        {
            var missing = json.DeepClone().AsObject();
            missing.Remove(name);
            Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<NodePropertyValue>(missing.ToJsonString(), options));
        }
        json["unknown"] = true;
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<NodePropertyValue>(json.ToJsonString(), options));
    }

    private static DesignToken Token(TokenType type, TokenValue value)
    {
        var literal = new LiteralTokenValue(value);
        return new(Guid.NewGuid(), type.ToString(), type, new Dictionary<TokenTheme, TokenExpression>
        {
            [TokenTheme.Light] = literal,
            [TokenTheme.Dark] = literal
        });
    }

    public void Dispose()
    {
        if (Directory.Exists(directory))
            Directory.Delete(directory, recursive: true);
    }
}
