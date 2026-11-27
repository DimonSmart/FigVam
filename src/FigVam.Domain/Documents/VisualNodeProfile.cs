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
            ("borderStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.BorderStyle)),
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
            ("textStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.TextStyle)),
            ("typography", new(NodePropertyType.TokenReference, TokenType: TokenType.Typography)),
            .. Typography(16, Ink),
            ("textAlignment", Alignment),
            ("lineHeight", Number(1.25, 0.1, 10)),
            ("wrap", Boolean(true))
        ]),
        Kind("Button", NodeSemanticRole.Button, 120, 40, events: [PreviewEvent.Click], properties:
        [
            ("text", String("Button")),
            ("enabled", Boolean(true)),
            ("textStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.TextStyle)),
            ("borderStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.BorderStyle)),
            ("typography", new(NodePropertyType.TokenReference, TokenType: TokenType.Typography)),
            .. Typography(14, White),
            ("lineHeight", Number(1.25, 0.1, 10) with { DefaultValue = null }),
            .. Decoration(new(47, 87, 191), 0, Transparent, 6)
        ]),
        Kind("TextInput", NodeSemanticRole.TextInput, 220, 40, events: [PreviewEvent.Change, PreviewEvent.Submit], demoValue: true, properties:
        [
            ("placeholder", String("")),
            ("value", String("")),
            ("multiline", Boolean(false)),
            ("inputType", Options("Text", "Password")),
            ("enabled", Boolean(true)),
            ("textStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.TextStyle)),
            ("borderStyle", new(NodePropertyType.StyleReference, StyleType: DesignStyleType.BorderStyle)),
            ("typography", new(NodePropertyType.TokenReference, TokenType: TokenType.Typography)),
            .. Typography(14, Ink),
            ("paddingTop", Length(0)),
            ("paddingRight", Length(4)),
            ("paddingBottom", Length(0)),
            ("paddingLeft", Length(4)),
            ("placeholderColor", Color(Ink) with { DefaultValue = null }),
            ("focusBorderColor", Color(Outline) with { DefaultValue = null }),
            ("focusBorderWidth", Length(2) with { DefaultValue = null }),
            ("lineHeight", Number(1.25, 0.1, 10) with { DefaultValue = null }),
            .. Decoration(White, 1, Outline, 6)
        ]),
        Kind("Image", NodeSemanticRole.Image, 160, 120, properties:
        [
            ("asset", new(NodePropertyType.Asset) { Required = true }),
            ("fit", Options("Contain", "Cover", "Stretch")),
            ("altText", String(""))
        ])
    }.Select(kind => kind with
    {
        Properties = kind.Properties.ToDictionary(entry => entry.Key, entry => TokenizedProperty(entry.Key, entry.Value))
            .ToFrozenDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal)
    }).ToArray());
    private static NodePropertyDefinition TokenizedProperty(string name, NodePropertyDefinition old) => name switch
    {
        "shadow" => old with { TokenType = TokenType.Shadow },
        "width" or "height" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Size },
        "opacity" => old with { TokenType = TokenType.Number, TokenCategory = TokenCategory.Opacity },
        "paddingTop" or "paddingRight" or "paddingBottom" or "paddingLeft" or "gap" => old with
        { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Spacing, LegacyTokenType = TokenType.Spacing },
        "cornerRadius" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.Radius,
            LegacyTokenType = TokenType.Geometry },
        "borderWidth" or "focusBorderWidth" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.BorderWidth },
        "fontSize" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.FontSize },
        "fontFamily" => old with { TokenType = TokenType.FontFamily },
        "fontWeight" => old with { TokenType = TokenType.FontWeight, NumericFontWeight = true,
            Minimum = 1, Maximum = 1000 },
        "lineHeight" => old with { TokenType = TokenType.Number, TokenCategory = TokenCategory.LineHeight },
        "letterSpacing" => old with { TokenType = TokenType.Dimension, TokenCategory = TokenCategory.LetterSpacing },
        _ => old
    };
    private static readonly FrozenDictionary<string, NodeKindDefinition> Registry =
        NodeKinds.ToFrozenDictionary(kind => kind.Kind, StringComparer.Ordinal);

    public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
    public IReadOnlyList<NodeKindDefinition> Kinds => NodeKinds;
    public IReadOnlyList<string> PreviewActions => ActionNames;
    public bool IsKnownKind(string kind) => Find(kind) is not null;
    public bool CanContainChildren(string kind) => Find(kind)?.CanContainChildren == true;
    public NodePropertyDefinition? GetProperty(string kind, string property) => Find(kind)?.Properties.GetValueOrDefault(property);
    public bool SupportsPreviewEvent(string kind, PreviewEvent @event) => Find(kind)?.PreviewEvents.Contains(@event) == true;
    public bool SupportsDemoValue(string kind) => Find(kind)?.SupportsDemoValue == true;
    public bool SupportsPreviewAction(PreviewAction action) => Actions.ContainsKey(action.GetType());

    private static NodeKindDefinition? Find(string? kind) => kind is null ? null : Registry.GetValueOrDefault(kind);

    public static NodePropertyError? ValidateTextInputCombination(INodeProfile profile, NodeStructure node,
        IReadOnlyList<ScreenPropertyOverride>? overrides = null)
    {
        if (node.Kind != "TextInput") return null;
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
            .. (role == NodeSemanticRole.Text ? Array.Empty<(string, NodePropertyDefinition)>() :
                new (string, NodePropertyDefinition)[] { ("shadow", new(NodePropertyType.Shadow)) }),
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
        ("letterSpacing", Number(0, -100, 100)),
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

