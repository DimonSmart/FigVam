using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Server.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public sealed class ComponentDetachmentTests
{
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Version1;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public bool IsKnownKind(string kind) => kind is "container" or "text";
        public bool CanContainChildren(string kind) => kind == "container";
        public NodePropertyDefinition? GetProperty(string kind, string property) => property == "text" ? new(NodePropertyType.String) : null;
    }
    private static readonly Profile Registry = new();
    private static readonly IReadOnlyDictionary<Guid, ComponentValue> NoChanges = new Dictionary<Guid, ComponentValue>();
    private static readonly IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> NoSlots = new Dictionary<Guid, IReadOnlyList<Guid>>();
    private static ComponentModel Model()
    {
        var root = Guid.NewGuid(); var label = Guid.NewGuid(); var slot = Guid.NewGuid();
        var anchor = Guid.NewGuid(); var content = Guid.NewGuid(); var fallback = Guid.NewGuid();
        var parameter = new ComponentParameter(Guid.NewGuid(), "Title", ComponentParameterType.Text, new ComponentText("Base"));
        var variant = new ComponentVariant(Guid.NewGuid(), "Hover", ComponentVariantKind.Hover, null,
            new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Variant") });
        var definition = new ComponentDefinition(Guid.NewGuid(), "Card", "", root, [parameter], [new(Guid.NewGuid(), "Body", slot)], [variant])
        { Bindings = [new(parameter.Id, label, "text")] };
        return new(new(Guid.NewGuid(), [], [new(Guid.NewGuid(), [root, anchor], new(800, 600))],
            [new(root, "container", [label, slot]), new(label, "text", []), new(slot, "container", [fallback]),
             new(fallback, "text", []), new(anchor, "container", [content]), new(content, "text", [])]),
            [definition], [new(anchor, definition.Id, variant.Id, NoChanges,
                new Dictionary<Guid, IReadOnlyList<Guid>> { [definition.Slots[0].Id] = [content] })], [], []);
    }

    [Theory]
    [InlineData(false, "Variant")]
    [InlineData(true, "Override")]
    public void MaterializesResolvedPropertiesSlotsAndDistinctStableIdentities(bool overridden, string expected)
    {
        var model = Model(); var definition = model.Definitions[0]; var instance = model.Instances[0];
        if (overridden) model = model with { Instances = [instance with { ParameterOverrides = new Dictionary<Guid, ComponentValue>
            { [definition.Parameters[0].Id] = new ComponentText("Override") } }] };
        var original = JsonSerializer.Serialize(model);
        var result = ComponentOperations.Detach(model, instance.NodeId, Registry);
        Assert.Empty(ComponentValidator.Validate(result, Registry));
        Assert.Empty(result.Instances);
        Assert.Equal(original, JsonSerializer.Serialize(model));
        Assert.Equal(model.Structure.Screens, result.Structure.Screens);
        var anchor = result.Structure.Nodes.Single(n => n.Id == instance.NodeId);
        Assert.Equal("container", anchor.Kind);
        var label = result.Structure.Nodes.Single(n => n.Id == anchor.ChildIds[0]);
        Assert.Equal(new NodeStringValue(expected), label.Properties["text"]);
        var slot = result.Structure.Nodes.Single(n => n.Id == anchor.ChildIds[1]);
        var content = instance.SlotContent.Values.Single().Single();
        Assert.Equal(content, slot.ChildIds[1]);
        Assert.Equal(model.Structure.Nodes.Single(n => n.Id == content), result.Structure.Nodes.Single(n => n.Id == content));
        var originalIds = model.Structure.Nodes.Select(n => n.Id).ToHashSet();
        var copies = result.Structure.Nodes.Where(n => !originalIds.Contains(n.Id)).ToArray();
        Assert.Equal(3, copies.Length);
        Assert.Equal(copies.Length, copies.Select(n => n.Id).Distinct().Count());
        Assert.DoesNotContain(copies, n => n.Id == Guid.Empty);
        var changed = ComponentOperations.UpdateDefinition(result, definition with
        { Parameters = [definition.Parameters[0] with { DefaultValue = new ComponentText("Later") }], Variants = [] }, Registry);
        changed = changed with { Structure = DocumentStructureEditor.SetNodeProperty(changed.Structure, definition.Bindings[0].NodeId, "text", new NodeStringValue("Edited")) };
        Assert.Equal(label, changed.Structure.Nodes.Single(n => n.Id == label.Id));
        var deleted = ComponentOperations.DeleteDefinition(changed, definition.Id, Registry);
        Assert.Equal(anchor, deleted.Structure.Nodes.Single(n => n.Id == anchor.Id));
    }

    [Fact]
    public void MaterializesNestedInstancesAndTheirSlotsWithoutChangingOriginalDefinitions()
    {
        var model = Model(); var outer = model.Definitions[0]; var outerInstance = model.Instances[0];
        var nestedAnchor = model.Structure.Nodes.Single(n => n.Id == outer.Bindings[0].NodeId);
        var nestedRoot = Guid.NewGuid(); var nestedSlot = Guid.NewGuid(); var nestedContent = Guid.NewGuid();
        var parameter = new ComponentParameter(Guid.NewGuid(), "Title", ComponentParameterType.Text, new ComponentText("Nested base"));
        var nestedDefinition = new ComponentDefinition(Guid.NewGuid(), "Nested", "", nestedRoot, [parameter], [new(Guid.NewGuid(), "Body", nestedSlot)], [])
        { Bindings = [new(parameter.Id, nestedRoot, "text")] };
        model = model with
        {
            Definitions = [outer, nestedDefinition],
            Structure = model.Structure with
            {
                Screens = [model.Structure.Screens[0] with { ChildIds = [.. model.Structure.Screens[0].ChildIds, nestedRoot] }],
                Nodes = [.. model.Structure.Nodes.Where(n => n.Id != nestedAnchor.Id), nestedAnchor with { Kind = "container", ChildIds = [nestedContent] },
                    new(nestedRoot, "container", [nestedSlot]), new(nestedSlot, "container", []), new(nestedContent, "text", [])]
            },
            Instances = [outerInstance, new(nestedAnchor.Id, nestedDefinition.Id, null,
                new Dictionary<Guid, ComponentValue> { [parameter.Id] = new ComponentText("Nested override") },
                new Dictionary<Guid, IReadOnlyList<Guid>> { [nestedDefinition.Slots[0].Id] = [nestedContent] })]
        };
        Assert.Empty(ComponentValidator.Validate(model, Registry));
        var result = ComponentOperations.Detach(model, outerInstance.NodeId, Registry);
        Assert.Empty(ComponentValidator.Validate(result, Registry));
        Assert.Single(result.Instances); // The definition's original nested instance remains linked.
        Assert.Equal(nestedAnchor.Id, result.Instances[0].NodeId);
        var detached = result.Structure.Nodes.Single(n => n.Id == outerInstance.NodeId);
        var nested = result.Structure.Nodes.Single(n => n.Id == detached.ChildIds[0]);
        Assert.Equal(new NodeStringValue("Nested override"), nested.Properties["text"]);
        var slot = result.Structure.Nodes.Single(n => n.Id == nested.ChildIds[0]);
        Assert.Single(slot.ChildIds);
        Assert.NotEqual(nestedContent, slot.ChildIds[0]);
        var changed = ComponentOperations.UpdateDefinition(result, nestedDefinition with
        { Parameters = [parameter with { DefaultValue = new ComponentText("Later") }] }, Registry);
        Assert.Equal(nested, changed.Structure.Nodes.Single(n => n.Id == nested.Id));
        Assert.Equal(model.Structure.Nodes.Single(n => n.Id == nestedAnchor.Id), result.Structure.Nodes.Single(n => n.Id == nestedAnchor.Id));
    }

    [Fact]
    public void PreservesSuppliedNestedInstanceIdentityAndMaterializesItsOwnVariantAndSlotContent()
    {
        var model = Model(); var definition = model.Definitions[0]; var outer = model.Instances[0];
        var content = outer.SlotContent.Values.Single().Single();
        var innerContent = Guid.NewGuid();
        model = model with
        {
            Structure = model.Structure with { Nodes = [.. model.Structure.Nodes.Select(n => n.Id == content
                ? n with { Kind = "container", ChildIds = [innerContent] } : n), new(innerContent, "text", [])] },
            Instances = [outer, new(content, definition.Id, outer.VariantId, NoChanges,
                new Dictionary<Guid, IReadOnlyList<Guid>> { [definition.Slots[0].Id] = [innerContent] })]
        };
        var result = ComponentOperations.Detach(model, outer.NodeId, Registry);
        Assert.Empty(ComponentValidator.Validate(result, Registry));
        Assert.Empty(result.Instances);
        var preserved = result.Structure.Nodes.Single(n => n.Id == content);
        Assert.Equal(new NodeStringValue("Variant"), result.Structure.Nodes.Single(n => n.Id == preserved.ChildIds[0]).Properties["text"]);
        var innerSlot = result.Structure.Nodes.Single(n => n.Id == preserved.ChildIds[1]);
        Assert.Equal(innerContent, innerSlot.ChildIds.Last());
        Assert.Equal(model.Structure.Nodes.Single(n => n.Id == innerContent), result.Structure.Nodes.Single(n => n.Id == innerContent));
    }

    private sealed class SeedJournal(DocumentStructure document) : IDocumentCommandJournal, IDocumentAuthorization
    {
        public ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid id, CancellationToken token) => ValueTask.FromResult(false);
        public DocumentState State { get; private set; } = new(document, 10);
        public DocumentEvent? Event { get; private set; }
        public ValueTask<bool> CanReadAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public ValueTask<bool> CanEditAsync(DocumentActor actor, Guid id, CancellationToken ct) => ValueTask.FromResult(true);
        public async Task<CommandResult> ExecuteAsync(Guid documentId, Guid commandId,
            Func<DocumentState?, Func<Guid, DocumentVersionResult>, Func<string, IReadOnlyList<DocumentCommandHistoryEntry>>, DocumentChange> apply,
            CancellationToken cancellationToken = default, Func<ValueTask<CommandResult?>>? authorize = null)
        {
            if (authorize is not null && await authorize() is { } denied) return denied;
            var change = apply(State, _ => throw new NotSupportedException(), _ => []);
            if (change.State is not null) State = change.State;
            Event = change.Event;
            return change.Result;
        }
    }

    [Fact]
    public async Task CommandMaterializesVariantsBindingsAndSlotsAndRejectsUnsupportedProfilesAtomically()
    {
        var model = Model();
        var document = model.Structure with { ComponentDefinitions = model.Definitions, ComponentInstances = model.Instances };
        var journal = new SeedJournal(document);
        var command = new DetachComponentInstanceCommand(document.Id, Guid.NewGuid(), model.Instances[0].NodeId, 10);
        var rejected = await new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile()).HandleAsync(command, new("owner"));
        Assert.Equal("INVALID_COMPONENT", rejected.Code);
        Assert.Equal(10, journal.State.Revision);
        Assert.Null(journal.Event);
        Assert.Same(document, journal.State.Document);
        var accepted = await new DocumentCommandHandler(journal, journal, Registry).HandleAsync(command, new("owner"));
        Assert.True(accepted.Accepted);
        Assert.Empty(journal.State.Document.ComponentInstances);
        Assert.Empty(DocumentStructureValidator.Validate(journal.State.Document, Registry));
        var anchor = journal.State.Document.Nodes.Single(n => n.Id == command.NodeId);
        Assert.Equal(new NodeStringValue("Variant"), journal.State.Document.Nodes.Single(n => n.Id == anchor.ChildIds[0]).Properties["text"]);
        var supplied = model.Instances[0].SlotContent.Values.Single().Single();
        Assert.Contains(supplied, journal.State.Document.Nodes.Single(n => n.Id == anchor.ChildIds[1]).ChildIds);
        var payload = Assert.IsType<ComponentInstanceDetached>(journal.Event);
        var replayed = payload.Patch.Apply(document);
        Assert.Equal(JsonSerializer.Serialize(journal.State.Document), JsonSerializer.Serialize(replayed));
    }

    [Fact]
    public async Task CommandRejectsMaterializationThatCannotPreserveChildrenUnderTheResolvedLeafRoot()
    {
        var root = Guid.NewGuid(); var anchor = Guid.NewGuid(); var child = Guid.NewGuid();
        var definition = new ComponentDefinition(Guid.NewGuid(), "Leaf", "", root, [], [], []);
        var document = new DocumentStructure(Guid.NewGuid(), [], [new(Guid.NewGuid(), [root, anchor], new(800, 600))],
            [new(root, "text", []), new(anchor, "container", [child]), new(child, "text", [])])
        {
            ComponentDefinitions = [definition],
            ComponentInstances = [new(anchor, definition.Id, null, NoChanges, NoSlots)]
        };
        Assert.Empty(DocumentStructureValidator.Validate(document, Registry));
        var journal = new SeedJournal(document);
        var result = await new DocumentCommandHandler(journal, journal, Registry).HandleAsync(
            new DetachComponentInstanceCommand(document.Id, Guid.NewGuid(), anchor, 10), new("owner"));
        Assert.Equal("INVALID_COMPONENT", result.Code);
        Assert.Equal(10, journal.State.Revision);
        Assert.Same(document, journal.State.Document);
        Assert.Null(journal.Event);
    }

    [Fact]
    public void RejectsInvalidOrMissingInstancesAtomically()
    {
        var model = Model();
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.Detach(model, Guid.NewGuid(), Registry));
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.Detach(model, model.Definitions[0].RootNodeId, Registry));
        var instance = model.Instances[0];
        var invalid = model with { Instances = [instance with { ParameterOverrides = new Dictionary<Guid, ComponentValue>
            { [model.Definitions[0].Parameters[0].Id] = new ComponentNumber(1) } }] };
        var before = JsonSerializer.Serialize(invalid);
        Assert.Throws<InvalidOperationException>(() => ComponentOperations.Detach(invalid, instance.NodeId, Registry));
        Assert.Equal(before, JsonSerializer.Serialize(invalid));
    }
}
