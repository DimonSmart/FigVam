using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public sealed partial class NodeRepeaterTests
{
    private DocumentStructure ComponentDocument(string fixture)
    {
        var root = Guid.NewGuid(); var label = Guid.NewGuid(); var slotContainer = Guid.NewGuid();
        var definitionId = Guid.NewGuid(); var parameter = Guid.NewGuid(); var variant = Guid.NewGuid(); var slot = Guid.NewGuid();
        var content = Guid.NewGuid(); var emptyContent = Guid.NewGuid();
        var definition = new ComponentDefinition(definitionId, "Card", "Reusable card", root,
            [new(parameter, "Label", ComponentParameterType.Text, new ComponentText("default"))],
            [new(slot, "Content", slotContainer)],
            [new(variant, "Selected", ComponentVariantKind.Selected, null, new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("variant") })])
        { Bindings = [new(parameter, label, "text")] };
        var document = Document(fixture);
        return document with
        {
            Screens = [new(screen, [owner, root])],
            Nodes = [document.Nodes[0], new(template, "container", [content]), new(empty, "container", [emptyContent]),
                new(content, "text", []), new(emptyContent, "text", []),
                new(root, "container", [label, slotContainer]), new(label, "text", []), new(slotContainer, "container", [])],
            ComponentDefinitions = [definition],
            ComponentInstances = [new(template, definitionId, variant, new Dictionary<Guid, ComponentValue>(),
                    new Dictionary<Guid, IReadOnlyList<Guid>> { [slot] = new[] { content } }),
                new(empty, definitionId, variant, new Dictionary<Guid, ComponentValue> { [parameter] = new ComponentText("empty override") },
                    new Dictionary<Guid, IReadOnlyList<Guid>> { [slot] = new[] { emptyContent } })]
        };
    }

    [Theory]
    [InlineData("{\"rows\":[]}", 0, "empty override")]
    [InlineData("{\"rows\":[{},{}]}", 2, "variant")]
    public async Task ComponentTemplatesAndEmptyViewsResolveSlotsVariantsAndOverrides(string fixture, int count, string text)
    {
        var document = ComponentDocument(fixture);
        await Journal().InitializeAsync(document);
        Assert.True((await Handler().HandleAsync(Command(config: Config() with { Bindings = [] }), actor)).Accepted);
        var response = (await Queries().EvaluateAsync(doc, owner, 1, 0, 100, actor)).Response!;
        Assert.Null(response.Diagnostic); Assert.Equal(count, response.Total);
        var expanded = count == 0 ? response.EmptyViewNodes : response.TemplateNodes;
        Assert.Equal(4, expanded.Count);
        Assert.Equal(text, Assert.IsType<NodeStringValue>(Assert.Single(expanded, n => n.Properties.ContainsKey("text")).Properties["text"]).Value);
        var instance = document.ComponentInstances.Single(i => i.NodeId == (count == 0 ? empty : template));
        var supplied = Assert.Single(Assert.Single(instance.SlotContent).Value);
        var child = Assert.Single(expanded, n => n.SourceNodeId == supplied);
        Assert.Contains(expanded, n => n.ChildIds.Contains(child.Id));
        Assert.Equal(instance.NodeId, Assert.Single(child.InstancePath));
        Assert.Equal(instance.NodeId, expanded[0].BindingNodeId);
        Assert.Equal(Enumerable.Range(0, expanded.Count), expanded.Select(n => n.Id));
        Assert.Equal(JsonSerializer.Serialize(response), JsonSerializer.Serialize((await Queries().EvaluateAsync(doc, owner, 1, 0, 100, actor)).Response));
        var definition = Assert.Single(document.ComponentDefinitions);
        var parameter = Assert.Single(definition.Parameters).Id;
        Assert.True((await Handler().HandleAsync(new SetComponentParameterOverrideCommand(doc, Guid.NewGuid(), instance.NodeId,
            parameter, new ComponentText("changed")), actor)).Accepted);
        Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        var recovered = (await Queries().EvaluateAsync(doc, owner, null, 0, 100, actor)).Response!;
        Assert.Equal(JsonSerializer.Serialize(expanded), JsonSerializer.Serialize(count == 0 ? recovered.EmptyViewNodes : recovered.TemplateNodes));
        Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(doc, Guid.NewGuid()), actor)).Accepted);
        recovered = (await Queries().EvaluateAsync(doc, owner, null, 0, 100, actor)).Response!;
        Assert.Contains(count == 0 ? recovered.EmptyViewNodes : recovered.TemplateNodes, n => n.Properties.GetValueOrDefault("text") == new NodeStringValue("changed"));
        // Reopen storage after crossing its periodic snapshot threshold, then query an old revision.
        for (var i = 0; i < 33; i++) Assert.True((await Handler().HandleAsync(new AddPageCommand(doc, Guid.NewGuid(), Guid.NewGuid()), actor)).Accepted);
        Assert.Equal(JsonSerializer.Serialize(expanded), JsonSerializer.Serialize(count == 0
            ? (await Queries().EvaluateAsync(doc, owner, 1, 0, 100, actor)).Response!.EmptyViewNodes
            : (await Queries().EvaluateAsync(doc, owner, 1, 0, 100, actor)).Response!.TemplateNodes));
        Assert.Equal(JsonSerializer.Serialize(document.Nodes), JsonSerializer.Serialize((await Journal().ReadAsync(doc, 0)).State!.Document.Nodes));
    }

    [Fact]
    public void InvalidComponentsAndNestedRepeatersReturnDiagnosticsWithoutExpansion()
    {
        var document = ComponentDocument("{\"rows\":[{}]}"); var config = Config() with { Bindings = [] };
        var profile = new Profile();
        var instance = document.ComponentInstances[0];
        var invalid = document with { ComponentInstances = [instance with { DefinitionId = Guid.NewGuid() }, document.ComponentInstances[1]] };
        Assert.Equal("missing-reference", NodeRepeaterEvaluator.Evaluate(invalid, invalid.Nodes[0], config, profile).Diagnostic!.Code);
        invalid = document with { ComponentInstances = [instance with { VariantId = Guid.NewGuid() }, document.ComponentInstances[1]] };
        Assert.Equal("invalid-instance-variant", NodeRepeaterEvaluator.Evaluate(invalid, invalid.Nodes[0], config, profile).Diagnostic!.Code);
        var root = document.ComponentDefinitions[0].RootNodeId;
        invalid = document with { ComponentInstances = [.. document.ComponentInstances, instance with { NodeId = root, SlotContent = new Dictionary<Guid, IReadOnlyList<Guid>>() }] };
        Assert.Equal("component-cycle", NodeRepeaterEvaluator.Evaluate(invalid, invalid.Nodes[0], config, profile).Diagnostic!.Code);
        invalid = document with { Nodes = document.Nodes.Select(n => n.Id == root ? n with { Repeater = config } : n).ToArray() };
        Assert.Equal("INVALID_REPEATER", NodeRepeaterEvaluator.Evaluate(invalid, invalid.Nodes[0], config, profile).Diagnostic!.Code);
        var slotContent = instance.SlotContent.Single().Value.Single();
        invalid = document with { Screens = [new(screen, [owner, root, slotContent])] };
        Assert.Equal("INVALID_REPEATER", NodeRepeaterEvaluator.Evaluate(invalid, invalid.Nodes[0], config, profile).Diagnostic!.Code);
    }

    [Fact]
    public async Task ExpandedComponentSizeCountsAgainstSharedItemBudget()
    {
        var document = ComponentDocument(JsonSerializer.Serialize(new { rows = Enumerable.Range(0, 1000).Select(_ => new { }) }));
        var root = document.ComponentDefinitions[0].RootNodeId;
        var extra = Enumerable.Range(0, 10).Select(_ => new NodeStructure(Guid.NewGuid(), "text", [])).ToArray();
        document = document with { Nodes = [.. document.Nodes.Select(n => n.Id == root ? n with { ChildIds = [.. n.ChildIds, .. extra.Select(n => n.Id)] } : n), .. extra] };
        await Journal().InitializeAsync(document);
        var result = await Handler().HandleAsync(Command(config: Config() with { Bindings = [] }), actor);
        Assert.Equal("DATA_REPEATER_LIMIT", result.Code); Assert.Equal(0, (await Journal().ReadAsync(doc))!.Revision);
        Assert.Empty(NodeRepeaterEvaluator.Evaluate(document, document.Nodes[0], Config() with { Bindings = [] }, new Profile()).TemplateNodes);
    }

    [Fact]
    public void NestedInstancesHaveDistinctOccurrencesAndExponentialExpansionStops()
    {
        DocumentStructure Tree(int levels)
        {
            var document = Document("{\"rows\":[{}]}");
            var definitions = new List<ComponentDefinition>(); var instances = new List<ComponentInstance>();
            var nodes = new List<NodeStructure> { document.Nodes[0], new(template, "container", []), document.Nodes[2] };
            for (var i = 0; i < levels; i++)
            {
                var root = Guid.NewGuid(); var id = Guid.NewGuid();
                var children = i == 0 ? Array.Empty<Guid>() : new[] { Guid.NewGuid(), Guid.NewGuid() };
                nodes.Add(new(root, "container", children));
                foreach (var child in children)
                {
                    nodes.Add(new(child, "container", []));
                    instances.Add(new(child, definitions[^1].Id, null, new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>()));
                }
                definitions.Add(new(id, "Level " + i, "", root, [], [], []));
            }
            instances.Add(new(template, definitions[^1].Id, null, new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>()));
            return document with { Screens = [new(screen, [owner, .. definitions.Select(d => d.RootNodeId)])], Nodes = nodes,
                ComponentDefinitions = definitions, ComponentInstances = instances };
        }
        var config = Config() with { Bindings = [] };
        var small = Tree(3);
        var result = NodeRepeaterEvaluator.Evaluate(small, small.Nodes[0], config, new Profile());
        Assert.Null(result.Diagnostic); Assert.Equal(7, result.TemplateNodes.Count);
        var leaves = result.TemplateNodes.Where(n => n.SourceNodeId == small.ComponentDefinitions[0].RootNodeId).ToArray();
        Assert.Equal(4, leaves.Length); Assert.Equal(4, leaves.Select(n => string.Join('/', n.InstancePath)).Distinct().Count());
        Assert.All(result.TemplateNodes.SelectMany(n => n.ChildIds), id => Assert.InRange(id, 0, result.TemplateNodes.Count - 1));
        var large = Tree(20);
        result = NodeRepeaterEvaluator.Evaluate(large, large.Nodes[0], config, new Profile());
        Assert.Equal("DATA_REPEATER_LIMIT", result.Diagnostic!.Code); Assert.Null(result.Items); Assert.Empty(result.TemplateNodes);
    }

    [Fact]
    public async Task RelativeBindingsOverlayResolvedRootsAndSlotContent()
    {
        var document = ComponentDocument("{\"rows\":[{\"person\":{\"name\":\"Alice\"}},{\"person\":{\"name\":\"Bob\"}}]}");
        var content = document.ComponentInstances[0].SlotContent.Single().Value.Single();
        var binding = Config().Bindings[0];
        var config = Config() with { Bindings = [binding, binding with { NodeId = content }] };
        await Journal().InitializeAsync(document);
        Assert.True((await Handler().HandleAsync(Command(config: config), actor)).Accepted);
        var response = (await Queries().EvaluateAsync(doc, owner, 1, 1, 1, actor)).Response!;
        Assert.Equal(2, response.Total);
        Assert.All(Assert.Single(response.Items), item => Assert.Equal(new NodeStringValue("Bob"), item.Value));
        Assert.Contains(response.TemplateNodes, n => n.BindingNodeId == template);
        Assert.Contains(response.TemplateNodes, n => n.SourceNodeId == content);
        var definition = document.ComponentDefinitions[0];
        // Deleting referenced definition nodes and invalid slot assignment remain atomic refusals.
        Assert.False((await Handler().HandleAsync(new DeleteNodeCommand(doc, Guid.NewGuid(), definition.RootNodeId), actor)).Accepted);
        Assert.False((await Handler().HandleAsync(new SetComponentSlotContentCommand(doc, Guid.NewGuid(), template,
            definition.Slots[0].Id, [empty]), actor)).Accepted);
        Assert.False((await Handler().HandleAsync(new AddComponentDefinitionCommand(doc, Guid.NewGuid(), Guid.NewGuid(), "Invalid definition", "", content), actor)).Accepted);
        Assert.Equal(1, (await Journal().ReadAsync(doc))!.Revision);
    }
}
