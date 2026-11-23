using System.Collections.Frozen;
using System.Text.Json.Serialization;
using FigVam.Domain.Layout;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Documents;

[JsonConverter(typeof(JsonStringEnumConverter<NodeSemanticRole>))]
public enum NodeSemanticRole { Container, Text, Button, TextInput, Image }

public sealed record NodeKindDefinition(string Kind, NodeSemanticRole SemanticRole, bool CanContainChildren,
    IReadOnlyDictionary<string, NodePropertyDefinition> Properties, IReadOnlyList<PreviewEvent> PreviewEvents,
    bool SupportsDemoValue);

public sealed class VisualNodeProfile : INodeProfile
{
    private static readonly FrozenDictionary<Type, string> Actions = new Dictionary<Type, string>
    {
        [typeof(Navigate)] = "navigate",
        [typeof(ShowVariant)] = "showVariant",
        [typeof(SetDemoValue)] = "setDemoValue",
        [typeof(SelectDataset)] = "selectDataset",
        [typeof(OpenOverlay)] = "openOverlay",
        [typeof(CloseOverlay)] = "closeOverlay",
        [typeof(ResetPreview)] = "resetPreview"
    }.ToFrozenDictionary();

    private const double MaxGeometry = 1_000_000;
    private static readonly NodeColorValue Transparent = new(0, 0, 0, 0);
    private static readonly NodeColorValue Ink = new(28, 32, 40);
    private static readonly NodeColorValue White = new(255, 255, 255);
    private static readonly NodeColorValue Outline = new(122, 130, 142);
    private static readonly NodePropertyDefinition Alignment = Options(LayoutAlignment.Start, LayoutAlignment.Center, LayoutAlignment.End);
    private static readonly IReadOnlyList<string> ActionNames = Array.AsReadOnly(Actions.Values.Order(StringComparer.Ordinal).ToArray());
    private static readonly IReadOnlyList<NodeKindDefinition> NodeKinds = Array.AsReadOnly(new[]
    {
        Kind("Frame", NodeSemanticRole.Container, 240, 160, children: true, properties:
        [
            .. Decoration(Transparent, 0, Transparent, 0),
            ("layout", Options(LayoutFlow.Free, LayoutFlow.Horizontal, LayoutFlow.Vertical)),
            ("paddingTop", Spacing()),
            ("paddingRight", Spacing()),
            ("paddingBottom", Spacing()),
            ("paddingLeft", Spacing()),
            ("gap", Spacing()),
            ("mainAlignment", Alignment),
            ("crossAlignment", Alignment),
            ("overflow", Options(LayoutOverflow.Visible, LayoutOverflow.Clip))
        ]),
        Kind("Text", NodeSemanticRole.Text, 160, 36, properties:
        [
            ("text", String("Text")),
            .. Typography(16, Ink),
            ("textAlignment", Alignment),
            ("lineHeight", Number(1.25, 0.1, 10)),
            ("wrap", Boolean(true))
        ]),
        Kind("Button", NodeSemanticRole.Button, 120, 40, events: [PreviewEvent.Click], properties:
        [
            ("text", String("Button")),
            ("enabled", Boolean(true)),
            .. Typography(14, White),
            .. Decoration(new(47, 87, 191), 0, Transparent, 6)
        ]),
        Kind("TextInput", NodeSemanticRole.TextInput, 220, 40, events: [PreviewEvent.Change], demoValue: true, properties:
        [
            ("placeholder", String("")),
            ("value", String("")),
            ("multiline", Boolean(false)),
            ("enabled", Boolean(true)),
            .. Typography(14, Ink),
            .. Decoration(White, 1, Outline, 6)
        ]),
        Kind("Image", NodeSemanticRole.Image, 160, 120, properties:
        [
            ("asset", new(NodePropertyType.Asset) { Required = true }),
            ("fit", Options("Contain", "Cover", "Stretch")),
            ("altText", String(""))
        ])
    });
    // V2 definitions are frozen: the v3 registry derives from them without changing old documents.
    private static readonly IReadOnlyList<NodeKindDefinition> NodeKindsV3 = Array.AsReadOnly(NodeKinds
        .Select(kind => kind.Kind != "TextInput" ? kind : kind with
        {
            Properties = kind.Properties.Append(new KeyValuePair<string, NodePropertyDefinition>(
                "inputType", Options("Text", "Password")))
                .ToFrozenDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal),
            PreviewEvents = Array.AsReadOnly<PreviewEvent>([.. kind.PreviewEvents, PreviewEvent.Submit])
        }).ToArray());
    // v4 replaces only the property contracts that explicitly support atomic token values.
    // v2/v3 registries remain immutable for existing documents.
    private static readonly IReadOnlyList<NodeKindDefinition> NodeKindsV4 = Array.AsReadOnly(NodeKindsV3.Select(kind =>
        kind with { Properties = kind.Properties.ToDictionary(entry => entry.Key, entry => V4Property(entry.Key, entry.Value))
            .ToFrozenDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal) }).ToArray());
    private static NodePropertyDefinition V4Property(string name, NodePropertyDefinition old) => name switch
    {
        "width" or "height" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Size },
        "opacity" => old with { TokenType = TokenType.Number, TokenCategory = TokenCategory.Opacity },
        "paddingTop" or "paddingRight" or "paddingBottom" or "paddingLeft" or "gap" => old with
        { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Spacing, LegacyTokenType = TokenType.Spacing },
        "cornerRadius" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Radius,
            LegacyTokenType = TokenType.Geometry },
        "borderWidth" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.BorderWidth },
        "fontSize" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.FontSize },
        "fontFamily" => old with { TokenType = TokenType.FontFamily },
        "fontWeight" => old with { TokenType = TokenType.FontWeight, NumericFontWeight = true,
            Minimum = 1, Maximum = 1000 },
        "lineHeight" => old with { TokenType = TokenType.Number, TokenCategory = TokenCategory.LineHeight },
        _ => old
    };
    private static readonly FrozenDictionary<string, NodeKindDefinition> RegistryV4 =
        NodeKindsV4.ToFrozenDictionary(kind => kind.Kind, StringComparer.Ordinal);
    private static readonly FrozenDictionary<string, NodeKindDefinition> RegistryV2 =
        NodeKinds.ToFrozenDictionary(kind => kind.Kind, StringComparer.Ordinal);
    private static readonly FrozenDictionary<string, NodeKindDefinition> RegistryV3 =
        NodeKindsV3.ToFrozenDictionary(kind => kind.Kind, StringComparer.Ordinal);
    private static readonly UnverifiedNodeProfile Version1 = new();
    private static readonly VisualNodeProfile Version2Profile = new(2);
    private static readonly VisualNodeProfile Version3Profile = new(3);
    private static readonly VisualNodeProfile Version4Profile = new(4);
    private readonly int version;

    public VisualNodeProfile() : this(3) { }
    private VisualNodeProfile(int version) => this.version = version;
    public PortableUiProfileReference Identity => version switch
    {
        2 => PortableUiProfileReference.Version2,
        4 => PortableUiProfileReference.Version4,
        _ => PortableUiProfileReference.Version3
    };
    public INodeProfile? GetInstalledVersion(int requestedVersion) =>
        requestedVersion == 4 ? Version4Profile :
        requestedVersion == 3 ? Version3Profile :
        requestedVersion == 2 ? Version2Profile :
        requestedVersion == 1 ? Version1 : null;
    public IReadOnlyList<NodeKindDefinition> Kinds => version switch { 2 => NodeKinds, 4 => NodeKindsV4, _ => NodeKindsV3 };
    public IReadOnlyList<string> PreviewActions => ActionNames;
    public bool IsKnownKind(string kind) => Find(kind) is not null;
    public bool CanContainChildren(string kind) => Find(kind)?.CanContainChildren == true;
    public NodePropertyDefinition? GetProperty(string kind, string property) => Find(kind)?.Properties.GetValueOrDefault(property);
    public bool SupportsPreviewEvent(string kind, PreviewEvent @event) => Find(kind)?.PreviewEvents.Contains(@event) == true;
    public bool SupportsDemoValue(string kind) => Find(kind)?.SupportsDemoValue == true;
    public bool SupportsPreviewAction(PreviewAction action) => Actions.ContainsKey(action.GetType());

    private NodeKindDefinition? Find(string? kind) => kind is null ? null :
        (version switch { 2 => RegistryV2, 4 => RegistryV4, _ => RegistryV3 }).GetValueOrDefault(kind);

    public static NodePropertyError? ValidateTextInputCombination(INodeProfile profile, NodeStructure node,
        IReadOnlyList<ScreenPropertyOverride>? overrides = null)
    {
        if (profile.Identity.Version < 3 || node.Kind != "TextInput") return null;
        NodePropertyValue? Effective(string name) =>
            overrides?.LastOrDefault(item => item.NodeId == node.Id && item.Property == name)?.Value
            ?? node.Properties.GetValueOrDefault(name) ?? profile.GetProperty(node.Kind, name)?.DefaultValue;
        return Effective("inputType") is NodeEnumValue { Value: "Password" }
            && Effective("multiline") is NodeBooleanValue { Value: true }
            ? new("INVALID_PROPERTY_VALUE", "Password input cannot be multiline.") : null;
    }

    private static NodeKindDefinition Kind(string name, NodeSemanticRole role, double width, double height,
        (string Name, NodePropertyDefinition Definition)[] properties,
        bool children = false, PreviewEvent[]? events = null, bool demoValue = false)
    {
        (string Name, NodePropertyDefinition Definition)[] all =
        [
            ("x", Number(0, -MaxGeometry, MaxGeometry)),
            ("y", Number(0, -MaxGeometry, MaxGeometry)),
            ("width", Length(width)),
            ("height", Length(height)),
            ("widthMode", Options(LayoutSizeMode.Fixed)),
            ("heightMode", Options(LayoutSizeMode.Fixed)),
            ("opacity", Number(1, 0, 1)),
            ("visible", Boolean(true)),
            .. properties
        ];
        return new(name, role, children, all.ToFrozenDictionary(pair => pair.Name, pair => pair.Definition, StringComparer.Ordinal),
            Array.AsReadOnly(events ?? []), demoValue);
    }

    private static (string, NodePropertyDefinition)[] Decoration(NodeColorValue background, double borderWidth,
        NodeColorValue border, double radius) =>
    [
        ("backgroundColor", Color(background)),
        ("borderWidth", Length(borderWidth)),
        ("borderColor", Color(border)),
        ("cornerRadius", Length(radius))
    ];

    private static (string, NodePropertyDefinition)[] Typography(double size, NodeColorValue color) =>
    [
        ("fontSize", Number(size, 1, 1024)),
        ("fontFamily", String("") with { MaxLength = 128, Pattern = @"^(?:[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*)?$" }),
        ("fontFallback", Options("SansSerif", "Serif", "Monospace")),
        ("fontWeight", Options("Normal", "Medium", "Semibold", "Bold")),
        ("fontStyle", Options("Normal", "Italic")),
        ("textColor", Color(color))
    ];

    private static NodePropertyDefinition Number(double value, double min, double max) =>
        new(NodePropertyType.Number) { DefaultValue = new NodeNumberValue(value), Minimum = min, Maximum = max };
    private static NodePropertyDefinition Length(double value) => Number(value, 0, MaxGeometry);
    private static NodePropertyDefinition Spacing() => Length(0) with { TokenType = TokenType.Spacing };
    private static NodePropertyDefinition String(string value) => new(NodePropertyType.String) { DefaultValue = new NodeStringValue(value), MaxLength = 4096 };
    private static NodePropertyDefinition Boolean(bool value) => new(NodePropertyType.Boolean) { DefaultValue = new NodeBooleanValue(value) };
    private static NodePropertyDefinition Color(NodeColorValue value) =>
        new(NodePropertyType.Color, TokenType: TokenType.Color) { DefaultValue = value };
    private static NodePropertyDefinition Options<T>(T value, params T[] otherValues) where T : struct, Enum =>
        Options(value.ToString(), otherValues.Select(option => option.ToString()).ToArray());
    private static NodePropertyDefinition Options(string value, params string[] otherValues) =>
        new(NodePropertyType.Enum, EnumValues: Array.AsReadOnly<string>([value, .. otherValues]))
        { DefaultValue = new NodeEnumValue(value) };
}

public sealed class UnverifiedNodeProfile : INodeProfile
{
    public PortableUiProfileReference Identity => PortableUiProfileReference.Version1;
    public bool SupportsPreviewEvent(string kind, PreviewEvent @event) => false;
    public bool SupportsPreviewAction(PreviewAction action) => false;
    public bool SupportsDemoValue(string kind) => false;
    public bool IsKnownKind(string kind) => false;
    public bool CanContainChildren(string kind) => false;
    public NodePropertyDefinition? GetProperty(string kind, string property) => null;
}
