using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public class DocumentStructureTests
{
    private static readonly INodeProfile Profile = new TestProfile();
    private sealed class TestProfile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => kind is "container" or "leaf";
        public bool CanContainChildren(string kind) => kind == "container";
    }

    [Fact]
    public void ValidTreePreservesChildOrder()
    {
        var first = Guid.NewGuid(); var second = Guid.NewGuid(); var screen = Guid.NewGuid();
        var document = new DocumentStructure(Guid.NewGuid(), [new(Guid.NewGuid(), [screen])],
            [new(screen, [second, first], new(800, 600))], [new(first, "leaf", []), new(second, "leaf", [])]);
        Assert.Empty(DocumentStructureValidator.Validate(document, Profile));
        Assert.Equal(new[] { second, first }, document.Screens[0].ChildIds);
    }

    [Fact]
    public void ReportsDuplicateIdsAndIncorrectReferences()
    {
        var page = Guid.NewGuid(); var screen = Guid.NewGuid(); var missing = Guid.NewGuid();
        var document = new DocumentStructure(Guid.NewGuid(), [new(page, [missing, page])],
            [new(screen, [screen], new(800, 600))], [new(page, "leaf", [])]);
        var errors = DocumentStructureValidator.Validate(document, Profile);
        Assert.Contains(errors, e => e.Code == "duplicate-id" && e.ObjectId == page);
        Assert.Contains(errors, e => e.Code == "missing-reference" && e.ReferenceId == missing);
        Assert.Contains(errors, e => e.Code == "wrong-reference-type" && e.ReferenceId == page);
        Assert.Contains(errors, e => e.Code == "wrong-reference-type" && e.ReferenceId == screen);
        Assert.Contains(errors, e => e.Code == "node-ownership" && e.ObjectId == page);
    }

    [Fact]
    public void ReportsDisconnectedCycleAndMultipleParents()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid(); var shared = Guid.NewGuid(); var screen = Guid.NewGuid();
        var document = new DocumentStructure(Guid.NewGuid(), [new(Guid.NewGuid(), [screen])],
            [new(screen, [shared], new(800, 600))], [new(a, "container", [b]), new(b, "container", [a, shared]), new(shared, "leaf", [])]);
        var errors = DocumentStructureValidator.Validate(document, Profile);
        Assert.Contains(errors, e => e.Code == "cycle");
        Assert.Contains(errors, e => e.Code == "node-ownership" && e.ObjectId == shared);
    }

    [Fact]
    public void UsesProfileForNodeKindsAndChildren()
    {
        var leaf = Guid.NewGuid(); var child = Guid.NewGuid(); var unknown = Guid.NewGuid(); var screen = Guid.NewGuid();
        var document = new DocumentStructure(Guid.NewGuid(), [new(Guid.NewGuid(), [screen])],
            [new(screen, [leaf, unknown], new(800, 600))], [new(leaf, "leaf", [child]), new(child, "leaf", []), new(unknown, "candidate", [])]);
        var errors = DocumentStructureValidator.Validate(document, Profile);
        Assert.Contains(errors, e => e.Code == "children-not-allowed" && e.ObjectId == leaf);
        Assert.Contains(errors, e => e.Code == "unknown-node-kind" && e.ObjectId == unknown);
    }
}
