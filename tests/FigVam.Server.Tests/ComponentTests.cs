using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Tests;

public class ComponentTests
{
    private sealed class TestProfile : INodeProfile
    {
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind is "container" or "leaf";
        public bool CanContainChildren(string kind) => kind == "container";
    }
    private static readonly INodeProfile Profile = new TestProfile();
    private static readonly IReadOnlyDictionary<Guid, ComponentValue> NoChanges = new Dictionary<Guid, ComponentValue>();
    private static readonly IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> NoSlots = new Dictionary<Guid, IReadOnlyList<Guid>>();
    private static ComponentModel Model()
    {
        var root = Guid.NewGuid(); var slot = Guid.NewGuid(); var anchor = Guid.NewGuid(); var content = Guid.NewGuid();
        var definition = new ComponentDefinition(Guid.NewGuid(), "Card", "A reusable card", root,
            [new(Guid.NewGuid(), "Title", ComponentParameterType.Text, new ComponentText("Base"))],
            [new(Guid.NewGuid(), "Content", slot)], []);
        var structure = new DocumentStructure(Guid.NewGuid(), [], [new(Guid.NewGuid(), [root, anchor])],
            [new(root, "container", [slot]), new(slot, "container", []), new(anchor, "container", [content]), new(content, "leaf", [])]);
        return new(structure, [definition], [new(anchor, definition.Id, null, NoChanges,
            new Dictionary<Guid, IReadOnlyList<Guid>> { [definition.Slots[0].Id] = [content] })], [], []);
    }

    [Fact]
    public void DefinitionChangesPropagateWhileExplicitOverridesAndStableReferencesSurviveRenames()
    {
        var model = Model(); var definition = model.Definitions[0]; var instance = model.Instances[0]; var parameter = definition.Parameters[0];
        model = ComponentOperations.Rename(model, definition.Id, "Renamed", Profile);
        Assert.Equal(definition.Id, model.Instances[0].DefinitionId);
        var changed = model.Definitions[0] with { Parameters = [parameter with { Name = "Heading", DefaultValue = new ComponentText("Changed") }] };
        model = ComponentOperations.UpdateDefinition(model, changed, Profile);
        Assert.Equal(new ComponentText("Changed"), ComponentOperations.Resolve(model, instance.NodeId, Profile).Parameters[parameter.Id]);
        model = model with { Instances = [instance with { ParameterOverrides = new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Mine") } }] };
        changed = changed with { Parameters = [parameter with { DefaultValue = new ComponentText("Later") }] };
        model = ComponentOperations.UpdateDefinition(model, changed, Profile);
        Assert.Equal(new ComponentText("Mine"), ComponentOperations.Resolve(model, instance.NodeId, Profile).Parameters[parameter.Id]);
    }

    [Fact]
    public void VariantsContainDeltasAndResolveFromBaseBeforeInstanceOverrides()
    {
        var model = Model(); var d = model.Definitions[0]; var parameter = d.Parameters[0].Id;
        var baseline = new ComponentVariant(Guid.NewGuid(), "Default", ComponentVariantKind.Default, null,
            new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("Default") });
        var hover = new ComponentVariant(Guid.NewGuid(), "Hover", ComponentVariantKind.Hover, baseline.Id,
            new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("Hover") });
        var custom = new ComponentVariant(Guid.NewGuid(), "Danger", ComponentVariantKind.Custom, hover.Id, NoChanges);
        model = model with
        {
            Definitions = [d with { Variants = [baseline, hover, custom,
                new(Guid.NewGuid(), "Disabled", ComponentVariantKind.Disabled, null, NoChanges),
                new(Guid.NewGuid(), "Selected", ComponentVariantKind.Selected, null, NoChanges)] }],
            Instances = [model.Instances[0] with { VariantId = custom.Id }]
        };
        Assert.Equal(new ComponentText("Hover"), ComponentOperations.Resolve(model, model.Instances[0].NodeId, Profile).Parameters[parameter]);
        model = model with { Instances = [model.Instances[0] with { ParameterOverrides = new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("Explicit") } }] };
        Assert.Equal(new ComponentText("Explicit"), ComponentOperations.Resolve(model, model.Instances[0].NodeId, Profile).Parameters[parameter]);
    }

    [Fact]
    public void ValidatesAllParameterTypesAndTypedAssetAndTokenReferences()
    {
        var model = Model(); var token = Guid.NewGuid(); var asset = Guid.NewGuid();
        var themes = new Dictionary<TokenTheme, TokenExpression>
        {
            [TokenTheme.Light] = new LiteralTokenValue(new ColorValue(0, 0, 0)),
            [TokenTheme.Dark] = new LiteralTokenValue(new ColorValue(255, 255, 255))
        };
        model = model with { Tokens = [new(token, "Foreground", TokenType.Color, themes)], AssetIds = [asset],
            Definitions = [model.Definitions[0] with { Parameters = [
                new(Guid.NewGuid(), "Text", ComponentParameterType.Text, new ComponentText("Hi")),
                new(Guid.NewGuid(), "Image", ComponentParameterType.Asset, new ComponentAsset(asset)),
                new(Guid.NewGuid(), "Enabled", ComponentParameterType.Bool, new ComponentBool(true)),
                new(Guid.NewGuid(), "Count", ComponentParameterType.Number, new ComponentNumber(2)),
                new(Guid.NewGuid(), "Color", ComponentParameterType.TokenReference, new ComponentToken(token), TokenType.Color),
                new(Guid.NewGuid(), "Size", ComponentParameterType.Enum, new ComponentEnum("Small"), EnumValues: ["Small", "Large"])
            ] }] };
        Assert.Empty(ComponentValidator.Validate(model, Profile));
        var parameters = model.Definitions[0].Parameters.ToArray();
        parameters[1] = parameters[1] with { DefaultValue = new ComponentAsset(token) };
        parameters[3] = parameters[3] with { DefaultValue = new ComponentNumber(double.NaN) };
        parameters[4] = parameters[4] with { TokenType = TokenType.Spacing };
        parameters[5] = parameters[5] with { DefaultValue = new ComponentEnum("Unknown") };
        model = model with { Definitions = [model.Definitions[0] with { Parameters = parameters }] };
        var errors = ComponentValidator.Validate(model, Profile);
        Assert.Contains(errors, e => e.Code == "wrong-reference-type" && e.ReferenceId == token);
        Assert.Contains(errors, e => e.Code == "token-type-mismatch");
        Assert.Equal(2, errors.Count(e => e.Code == "incompatible-value"));
    }

    [Fact]
    public void RejectsMissingReferencesAndOverridesOutsideDeclaredContract()
    {
        var model = Model(); var instance = model.Instances[0]; var missing = Guid.NewGuid();
        model = model with { Instances = [instance with { ParameterOverrides = new Dictionary<Guid, ComponentValue>
        {
            [model.Definitions[0].Parameters[0].Id] = new ComponentBool(false), [missing] = new ComponentText("Unexpected")
        }, VariantId = missing }] };
        var errors = ComponentValidator.Validate(model, Profile);
        Assert.Contains(errors, e => e.Code == "incompatible-value");
        Assert.Contains(errors, e => e.Code == "incompatible-override" && e.ReferenceId == missing);
        Assert.Contains(errors, e => e.Code == "invalid-instance-variant");
        model = model with { Instances = [instance with { DefinitionId = missing }] };
        Assert.Contains(ComponentValidator.Validate(model, Profile), e => e.Code == "missing-reference" && e.ReferenceId == missing);
    }

    [Fact]
    public void RejectsDisconnectedComponentAndVariantDependencyCycles()
    {
        var model = Model(); var d = model.Definitions[0];
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        model = model with { Definitions = [d with { Variants = [
            new(a, "A", ComponentVariantKind.Custom, b, NoChanges),
            new(b, "B", ComponentVariantKind.Custom, a, NoChanges)] }],
            Instances = [.. model.Instances, new(d.RootNodeId, d.Id, null, NoChanges, NoSlots)] };
        var errors = ComponentValidator.Validate(model, Profile);
        Assert.Contains(errors, e => e.Code == "component-cycle");
        Assert.Contains(errors, e => e.Code == "variant-cycle");
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.Resolve(model, model.Instances[0].NodeId, Profile));
    }

    [Fact]
    public void SlotReferencesRespectSingleExistingStructuralOwnership()
    {
        var model = Model(); var d = model.Definitions[0]; var instance = model.Instances[0];
        model = model with { Instances = [instance with { SlotContent = new Dictionary<Guid, IReadOnlyList<Guid>>
        { [d.Slots[0].Id] = [d.RootNodeId, d.RootNodeId] } }] };
        var errors = ComponentValidator.Validate(model, Profile);
        Assert.Contains(errors, e => e.Code == "slot-ownership");
        Assert.Contains(errors, e => e.Code == "multiple-slot-assignment");
        model = Model();
        var slot = model.Definitions[0].Slots[0] with { ContainerNodeId = model.Instances[0].NodeId };
        model = model with { Definitions = [model.Definitions[0] with { Slots = [slot] }] };
        Assert.Contains(ComponentValidator.Validate(model, Profile), e => e.Code == "invalid-slot");
    }

    [Fact]
    public void InUseDeletionRequiresExplicitCompatibleReplacementAndDoesNotSilentlyDropOverrides()
    {
        var model = Model(); var d = model.Definitions[0]; var instance = model.Instances[0];
        Assert.Equal(new[] { instance.NodeId }, ComponentOperations.FindUsages(model, d.Id));
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.DeleteDefinition(model, d.Id, Profile));
        var replacement = new ComponentDefinition(Guid.NewGuid(), "Replacement", "", d.RootNodeId, [], [], []);
        model = ComponentOperations.AddDefinition(model, replacement, Profile);
        var mapping = new ComponentReplacement(replacement.Id, new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid>());
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.DeleteDefinition(model, d.Id, Profile, mapping));
        model = model with { Instances = [instance with { SlotContent = NoSlots }] };
        var deleted = ComponentOperations.DeleteDefinition(model, d.Id, Profile, mapping);
        Assert.Single(deleted.Definitions);
        Assert.Equal(replacement.Id, deleted.Instances[0].DefinitionId);
        Assert.Equal(model.Structure, deleted.Structure);
    }

    [Fact]
    public void ReplacementExplicitlyMapsStableParameterSlotAndVariantIds()
    {
        var model = Model(); var d = model.Definitions[0]; var parameter = d.Parameters[0];
        var variant = new ComponentVariant(Guid.NewGuid(), "Hover", ComponentVariantKind.Hover, null, NoChanges);
        d = d with { Variants = [variant] };
        var replacementParameter = parameter with { Id = Guid.NewGuid() };
        var replacementSlot = d.Slots[0] with { Id = Guid.NewGuid() };
        var replacementVariant = variant with { Id = Guid.NewGuid() };
        var replacement = d with { Id = Guid.NewGuid(), Parameters = [replacementParameter], Slots = [replacementSlot], Variants = [replacementVariant] };
        model = model with { Definitions = [d, replacement], Instances = [model.Instances[0] with { VariantId = variant.Id,
            ParameterOverrides = new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Kept") } }] };
        var mapping = new ComponentReplacement(replacement.Id,
            new Dictionary<Guid, Guid> { [parameter.Id] = replacementParameter.Id },
            new Dictionary<Guid, Guid> { [d.Slots[0].Id] = replacementSlot.Id },
            new Dictionary<Guid, Guid> { [variant.Id] = replacementVariant.Id });
        model = ComponentOperations.DeleteDefinition(model, d.Id, Profile, mapping);
        var resolved = ComponentOperations.Resolve(model, model.Instances[0].NodeId, Profile);
        Assert.Equal(new ComponentText("Kept"), resolved.Parameters[replacementParameter.Id]);
        Assert.Equal(replacementVariant.Id, model.Instances[0].VariantId);
        Assert.Single(resolved.SlotContent[replacementSlot.Id]);
    }
    [Fact]
    public void ReplacementCannotMergeDistinctParameters()
    {
        var model = Model(); var source = model.Definitions[0];
        var first = source.Parameters[0]; var second = first with { Id = Guid.NewGuid(), Name = "Other" };
        source = source with { Parameters = [first, second] };
        var targetParameter = first with { Id = Guid.NewGuid() };
        var target = source with { Id = Guid.NewGuid(), Parameters = [targetParameter], Slots = [], Variants = [] };
        model = model with { Definitions = [source, target], Instances = [model.Instances[0] with {
            ParameterOverrides = new Dictionary<Guid, ComponentValue> { [first.Id] = new ComponentText("First"), [second.Id] = new ComponentText("Second") },
            SlotContent = NoSlots }] };
        Assert.Empty(ComponentValidator.Validate(model, Profile));
        var mapping = new ComponentReplacement(target.Id,
            new Dictionary<Guid, Guid> { [first.Id] = targetParameter.Id, [second.Id] = targetParameter.Id },
            new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid>());
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.DeleteDefinition(model, source.Id, Profile, mapping));
    }

}
