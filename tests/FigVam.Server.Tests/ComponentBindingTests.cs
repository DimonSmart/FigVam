using System.Text.Json;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Tests;

public sealed class ComponentBindingTests
{
    private sealed class Profile : INodeProfile
    {
        public bool IsKnownKind(string kind) => kind == "test";
        public bool CanContainChildren(string kind) => true;
        public NodePropertyDefinition? GetProperty(string kind, string property) => property switch
        {
            "text" or "unbound" => new(NodePropertyType.String),
            "number" => new(NodePropertyType.Number, v => ((NodeNumberValue)v).Value >= 0 ? null : "Target requires a nonnegative number."),
            "bool" => new(NodePropertyType.Boolean),
            "asset" => new(NodePropertyType.Asset),
            "token" => new(NodePropertyType.TokenReference, TokenType: TokenType.Color),
            "enum" => new(NodePropertyType.Enum, EnumValues: ["Small", "Large"]),
            _ => null
        };
    }
    private static readonly Profile Registry = new();
    private static ComponentModel Model()
    {
        var root = Guid.NewGuid(); var child = Guid.NewGuid(); var anchor = Guid.NewGuid();
        var asset = Guid.NewGuid(); var token = Guid.NewGuid();
        ComponentParameter[] parameters = [
            new(Guid.NewGuid(), "Text", ComponentParameterType.Text, new ComponentText("Base")),
            new(Guid.NewGuid(), "Number", ComponentParameterType.Number, new ComponentNumber(2)),
            new(Guid.NewGuid(), "Bool", ComponentParameterType.Bool, new ComponentBool(true)),
            new(Guid.NewGuid(), "Asset", ComponentParameterType.Asset, new ComponentAsset(asset)),
            new(Guid.NewGuid(), "Token", ComponentParameterType.TokenReference, new ComponentToken(token), TokenType.Color),
            new(Guid.NewGuid(), "Enum", ComponentParameterType.Enum, new ComponentEnum("Small"), EnumValues: ["Small", "Large"])
        ];
        string[] names = ["text", "number", "bool", "asset", "token", "enum"];
        var definition = new ComponentDefinition(Guid.NewGuid(), "Card", "", root, parameters, [], [])
        { Bindings = parameters.Select((p, i) => new ComponentParameterBinding(p.Id, child, names[i])).ToArray() };
        return new(new(Guid.NewGuid(), [], [new(Guid.NewGuid(), [root, anchor])],
            [new(root, "test", [child]), new NodeStructure(child, "test", [])
            { Properties = new NodeStructure(child, "test", []).Properties.Add("unbound", new NodeStringValue("Kept")) },
            new(anchor, "test", [])]), [definition], [new(anchor, definition.Id, null,
                new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>())],
            [new(token, "Color", TokenType.Color, new Dictionary<TokenTheme, TokenExpression>())], [asset]);
    }

    [Fact]
    public void ResolvesAllTypesAndPreservesUnboundPropertiesWithoutChangingDefinition()
    {
        var model = Model();
        Assert.Empty(ComponentValidator.Validate(model, Registry));
        var resolved = ComponentOperations.Resolve(model, model.Instances[0].NodeId, Registry);
        var child = resolved.Nodes.Single(n => n.Id != model.Definitions[0].RootNodeId);
        Assert.Equal(7, child.Properties.Count);
        Assert.Equal(new NodeStringValue("Base"), child.Properties["text"]);
        Assert.Equal(new NodeNumberValue(2), child.Properties["number"]);
        Assert.Equal(new NodeBooleanValue(true), child.Properties["bool"]);
        Assert.Equal(new NodeAssetValue(model.AssetIds[0]), child.Properties["asset"]);
        Assert.Equal(new NodeTokenValue(model.Tokens[0].Id), child.Properties["token"]);
        Assert.Equal(new NodeEnumValue("Small"), child.Properties["enum"]);
        Assert.Equal(new NodeStringValue("Kept"), child.Properties["unbound"]);
        Assert.Single(model.Structure.Nodes[1].Properties);
        Assert.Equal(JsonSerializer.Serialize(child), JsonSerializer.Serialize(JsonSerializer.Deserialize<NodeStructure>(JsonSerializer.Serialize(child))));
    }

    [Fact]
    public void DefinitionAndVariantChangesPropagateWithExplicitOverrideTakingPrecedence()
    {
        var model = Model(); var definition = model.Definitions[0]; var parameter = definition.Parameters[0];
        var variant = new ComponentVariant(Guid.NewGuid(), "Default", ComponentVariantKind.Default, null,
            new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Variant") });
        var hover = new ComponentVariant(Guid.NewGuid(), "Hover", ComponentVariantKind.Hover, variant.Id,
            new Dictionary<Guid, ComponentValue>());
        NodePropertyValue Text(ComponentModel source) => ComponentOperations.Resolve(source, source.Instances[0].NodeId, Registry).Nodes[1].Properties["text"];
        model = ComponentOperations.UpdateDefinition(model, definition with { Parameters = [parameter with { DefaultValue = new ComponentText("New") }, .. definition.Parameters.Skip(1)] }, Registry);
        Assert.Equal(new NodeStringValue("New"), Text(model));
        model = ComponentOperations.UpdateDefinition(model, model.Definitions[0] with { Variants = [variant, hover] }, Registry);
        model = model with { Instances = [model.Instances[0] with { VariantId = hover.Id }] };
        Assert.Equal(new NodeStringValue("Variant"), Text(model));
        model = model with { Instances = [model.Instances[0] with { ParameterOverrides = new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Explicit") } }] };
        model = ComponentOperations.UpdateDefinition(model, model.Definitions[0] with { Variants = [variant with { ParameterChanges = new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Later") } }, hover] }, Registry);
        Assert.Equal(new NodeStringValue("Explicit"), Text(model));
        var child = model.Structure.Nodes[1];
        model = model with { Structure = DocumentStructureEditor.SetNodeProperty(model.Structure, child.Id, "unbound", new NodeStringValue("Updated")) };
        Assert.Equal(new NodeStringValue("Updated"), ComponentOperations.Resolve(model, model.Instances[0].NodeId, Registry).Nodes[1].Properties["unbound"]);
    }

    [Theory]
    [InlineData("parameter", "invalid-binding-parameter")]
    [InlineData("missing", "missing-binding-node")]
    [InlineData("outside", "binding-ownership")]
    [InlineData("property", "UNSUPPORTED_PROPERTY")]
    [InlineData("type", "incompatible-binding-type")]
    [InlineData("duplicate", "duplicate-property-binding")]
    public void RejectsInvalidBindingContracts(string invalid, string code)
    {
        var model = Model(); var definition = model.Definitions[0]; var binding = definition.Bindings[0];
        var changed = invalid switch
        {
            "parameter" => binding with { ParameterId = Guid.NewGuid() },
            "missing" => binding with { NodeId = Guid.NewGuid() },
            "outside" => binding with { NodeId = model.Instances[0].NodeId },
            "property" => binding with { Property = "unsupported" },
            "type" => binding with { Property = "bool" },
            _ => binding
        };
        model = model with { Definitions = [definition with { Bindings = invalid == "duplicate" ? [binding, binding] : [changed] }] };
        Assert.Contains(ComponentValidator.Validate(model, Registry), e => e.Code == code && e.Property == changed.Property);
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.Resolve(model, model.Instances[0].NodeId, Registry));
    }

    [Fact]
    public void ProfileRestrictionsApplyToDefaultsVariantsAndOverridesEvenIfCurrentlyMasked()
    {
        foreach (var source in new[] { "default", "variant", "override" })
        {
            var model = Model(); var definition = model.Definitions[0]; var parameter = definition.Parameters[1];
            var invalid = new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentNumber(-1) };
            if (source == "default") definition = definition with { Parameters = definition.Parameters.Select(p => p.Id == parameter.Id ? p with { DefaultValue = invalid[p.Id] } : p).ToArray() };
            if (source == "variant") definition = definition with { Variants = [new(Guid.NewGuid(), "Unused", ComponentVariantKind.Custom, null, invalid)] };
            model = model with { Definitions = [definition], Instances = [model.Instances[0] with { ParameterOverrides = source == "override" ? invalid : new Dictionary<Guid, ComponentValue>() }] };
            Assert.Contains(ComponentValidator.Validate(model, Registry), e => e.Code == "INVALID_PROPERTY_VALUE" && e.Property == "number" && e.Message.Contains("Target"));
        }
    }

    [Fact]
    public void RejectsMissingAssetsAndTokensAndMismatchedEnumAndTokenContracts()
    {
        var model = Model(); var definition = model.Definitions[0];
        model = model with { AssetIds = [], Tokens = [], Definitions = [definition with { Parameters = definition.Parameters.Select(p => p.Type switch
        {
            ComponentParameterType.TokenReference => p with { TokenType = TokenType.Spacing },
            ComponentParameterType.Enum => p with { EnumValues = ["Small", "Unsupported"] },
            _ => p
        }).ToArray() }] };
        var errors = ComponentValidator.Validate(model, Registry);
        Assert.Equal(2, errors.Count(e => e.Code == "missing-reference"));
        Assert.Equal(2, errors.Count(e => e.Code == "incompatible-binding-type"));
    }
}
