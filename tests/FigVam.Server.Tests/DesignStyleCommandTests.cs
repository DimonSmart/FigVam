using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DesignStyleCommandTests
{
    [Fact]
    public async Task StyleChangesAndResetAreAtomicIdempotentUndoableAndDurable()
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-styles-" + Guid.NewGuid());
        try
        {
            var actor = new DocumentActor("owner");
            var documentId = Guid.NewGuid();
            var profile = new VisualNodeProfile();
            SqliteDocumentJournal Journal() => new(directory, profile);
            DocumentCommandHandler Handler() { var journal = Journal(); return new(journal, journal, profile); }
            await Journal().CreateAsync(new(documentId), actor);
            long Revision() => Journal().ReadAsync(documentId).GetAwaiter().GetResult()!.Revision;

            var styleId = Guid.NewGuid();
            var baseStyle = new DesignStyle(styleId, "text.base", DesignStyleType.TextStyle,
                new Dictionary<string, NodePropertyValue>
                {
                    ["textColor"] = new NodeColorValue(20, 30, 40),
                    ["typography"] = new NodeTypographyValue(new FigVam.Domain.Tokens.TypographyValue(
                        "Arial", 18, 400, 1.25))
                });
            var create = new UpsertStyleCommand(documentId, Guid.NewGuid(), baseStyle, Revision());
            var accepted = await Handler().HandleAsync(create, actor);
            Assert.True(accepted.Accepted);
            Assert.Equal(accepted, await Handler().HandleAsync(create with
            { Style = baseStyle with { Name = "replaced" } }, actor));
            Assert.Equal("text.base", Assert.Single((await Journal().ReadAsync(documentId))!.Document.Styles).Name);

            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), actor)).Accepted);
            Assert.Empty((await Journal().ReadAsync(documentId))!.Document.Styles);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), actor)).Accepted);
            Assert.Equal(styleId, Assert.Single((await Journal().ReadAsync(documentId))!.Document.Styles).Id);

            var childId = Guid.NewGuid();
            var child = new DesignStyle(childId, "text.heading", DesignStyleType.TextStyle,
                new Dictionary<string, NodePropertyValue>(), styleId);
            Assert.True((await Handler().HandleAsync(new UpsertStyleCommand(documentId, Guid.NewGuid(), child, Revision()), actor)).Accepted);
            var beforeBadDelete = Revision();
            var denied = await Handler().HandleAsync(new DeleteStyleCommand(documentId, Guid.NewGuid(), styleId, Revision()), actor);
            Assert.Equal("STYLE_IN_USE", denied.Code);
            Assert.Equal(beforeBadDelete, Revision());

            var pageId = Guid.NewGuid(); var screenId = Guid.NewGuid(); var nodeId = Guid.NewGuid();
            Assert.True((await Handler().HandleAsync(new AddPageCommand(documentId, Guid.NewGuid(), pageId), actor)).Accepted);
            Assert.True((await Handler().HandleAsync(new AddScreenCommand(documentId, Guid.NewGuid(), pageId,
                screenId, new(800, 600)), actor)).Accepted);
            Assert.True((await Handler().HandleAsync(new AddNodeCommand(documentId, Guid.NewGuid(), screenId, nodeId, "Text"), actor)).Accepted);
            Assert.True((await Handler().HandleAsync(new SetNodePropertyCommand(documentId,
                Guid.NewGuid(), nodeId, "textStyle", new NodeStyleValue(childId)), actor)).Accepted);
            Assert.True((await Handler().HandleAsync(new SetNodePropertyCommand(documentId,
                Guid.NewGuid(), nodeId, "fontSize", new NodeNumberValue(32)), actor)).Accepted);
            var reset = new RemoveNodePropertiesCommand(documentId, Guid.NewGuid(), nodeId, ["fontSize"], Revision());
            Assert.True((await Handler().HandleAsync(reset, actor)).Accepted);
            var snapshot = (await Journal().ReadAsync(documentId))!.Document;
            var node = Assert.Single(snapshot.Nodes);
            Assert.False(node.Properties.ContainsKey("fontSize"));
            Assert.Equal(new NodeStyleValue(childId), node.Properties["textStyle"]);
            Assert.True((await Handler().HandleAsync(new UndoDocumentCommand(documentId, Guid.NewGuid()), actor)).Accepted);
            Assert.Equal(new NodeNumberValue(32), Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties["fontSize"]);
            Assert.True((await Handler().HandleAsync(new RedoDocumentCommand(documentId, Guid.NewGuid()), actor)).Accepted);
            Assert.False(Assert.Single((await Journal().ReadAsync(documentId))!.Document.Nodes).Properties.ContainsKey("fontSize"));

            var saved = await Handler().HandleAsync(new SaveDocumentCommand(documentId, Guid.NewGuid(), "styles"), actor);
            Assert.True(saved.Accepted);
            var restored = await Journal().ReadVersionAsync(documentId, saved.VersionId!.Value);
            Assert.Equal(2, restored.Version!.Snapshot.Document.Styles.Count);
            var json = JsonSerializer.Serialize((await Journal().ReadAsync(documentId))!.Document);
            var roundTripped = JsonSerializer.Deserialize<DocumentStructure>(json)!;
            Assert.Equal(styleId, roundTripped.Styles[0].Id);
            Assert.Equal(childId, roundTripped.Styles[1].Id);
            Assert.Equal(new NodeStyleValue(childId), Assert.Single(roundTripped.Nodes).Properties["textStyle"]);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
