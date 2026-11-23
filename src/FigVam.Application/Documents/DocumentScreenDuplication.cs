using FigVam.Domain.Documents;
using FigVam.Domain.Components;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(DuplicateScreenCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        CommandResult Result(string code, long? revision = null, Guid? pageId = null, string? detail = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, pageId, DateTimeOffset.UtcNow,
                ScreenId: command.NewScreenId, Explanation: detail);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty ||
            command.ScreenId == Guid.Empty || command.NewScreenId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var source = state.Document.Screens.FirstOrDefault(s => s.Id == command.ScreenId);
            if (source is null) return new(Result("SCREEN_NOT_FOUND"), null);
            var page = state.Document.Pages.FirstOrDefault(p => p.ScreenIds.Contains(source.Id));
            if (page is null) return new(Result("PAGE_NOT_FOUND"), null);
            if (state.Document.Screens.Any(s => s.Id == command.NewScreenId))
                return new(Result("DUPLICATE_ID"), null);
            if (!ScreenDuplication.TryCopy(state.Document, source, page.Id, command.NewScreenId,
                    out var updated, out var reason))
                return new(Result("INVALID_SCREEN_STRUCTURE", detail: reason), null);
            if (DocumentStructureValidator.Validate(updated!, profile).FirstOrDefault() is { } error)
                return new(Result(error.Code == "duplicate-id" ? "DUPLICATE_ID" : error.Code, detail: error.Message), null);
            var patch = DocumentPatch.Between(state.Document, updated!);
            var next = new DocumentState(updated!, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision, page.Id) with
            {
                AffectedIds = [command.NewScreenId, .. patch.Nodes.Select(n => n.Id)]
            }, next, new ScreenDuplicated(command.NewScreenId, patch));
        }, cancellationToken,
            authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)
                ? null : Result("FORBIDDEN"));
    }
}

internal static class ScreenDuplication
{
    public static bool TryCopy(DocumentStructure document, ScreenStructure source, Guid pageId, Guid screenId,
        out DocumentStructure? copy, out string? reason)
    {
        copy = null;
        reason = null;
        var existing = document.Nodes.ToDictionary(n => n.Id);
        var reachable = new HashSet<Guid>();
        var pending = new Stack<Guid>(source.ChildIds);
        while (pending.TryPop(out var id))
        {
            if (!existing.TryGetValue(id, out var node))
            {
                reason = "The source screen contains a missing node.";
                return false;
            }
            if (!reachable.Add(id))
            {
                reason = "The source screen reuses a node or contains a cycle.";
                return false;
            }
            foreach (var child in node.ChildIds) pending.Push(child);
        }
        var ids = reachable.ToDictionary(id => id, _ => Guid.NewGuid());
        Guid Local(Guid id)
        {
            if (!ids.TryGetValue(id, out var mapped))
                throw new InvalidOperationException("A reference escapes the source screen.");
            return mapped;
        }
        try
        {
            var nodes = document.Nodes.Where(n => reachable.Contains(n.Id)).Select(node =>
            {
                var repeater = node.Repeater is null ? null : node.Repeater with
                {
                    TemplateNodeId = Local(node.Repeater.TemplateNodeId),
                    EmptyViewNodeId = Local(node.Repeater.EmptyViewNodeId),
                    Bindings = node.Repeater.Bindings.Select(binding =>
                        binding with { NodeId = Local(binding.NodeId) }).ToArray()
                };
                return node with { Id = Local(node.Id), ChildIds = node.ChildIds.Select(Local).ToArray(),
                    Repeater = repeater };
            }).ToArray();

            var variants = source.Variants.Select(variant => new ScreenVariant(Guid.NewGuid(), variant.Name,
                variant.Overrides.Select(item => item with { NodeId = Local(item.NodeId) }).ToArray())).ToArray();
            var title = source.Name is { Length: > 0 } name ? name : "Screen";
            const int maxBaseLength = 249;
            var screen = source with
            {
                Id = screenId, Name = title[..Math.Min(title.Length, maxBaseLength)] + " (copy)",
                ChildIds = source.ChildIds.Select(Local).ToArray(), Variants = variants
            };
            var instances = document.ComponentInstances.Where(i => reachable.Contains(i.NodeId)).Select(instance =>
                instance with
                {
                    NodeId = Local(instance.NodeId),
                    SlotContent = instance.SlotContent.ToDictionary(pair => pair.Key,
                        pair => (IReadOnlyList<Guid>)pair.Value.Select(Local).ToArray())
                }).ToArray();
            copy = document with
            {
                Pages = document.Pages.Select(page => page.Id == pageId ? page with
                {
                    ScreenIds = InsertAfter(page.ScreenIds, source.Id, screenId)
                } : page).ToArray(),
                Screens = InsertAfterScreens(document.Screens, source.Id, screen),
                Nodes = [.. document.Nodes, .. nodes],
                ComponentInstances = [.. document.ComponentInstances, .. instances]
            };
            return true;
        }
        catch (InvalidOperationException exception)
        {
            reason = exception.Message;
            return false;
        }
    }

    private static ScreenStructure[] InsertAfterScreens(IReadOnlyList<ScreenStructure> items, Guid anchor, ScreenStructure item)
    {
        var index = items.ToList().FindIndex(existing => existing.Id == anchor);
        var output = items.ToList();
        output.Insert(index + 1, item);
        return output.ToArray();
    }

    private static Guid[] InsertAfter(IReadOnlyList<Guid> items, Guid anchor, Guid item)
    {
        var output = items.ToList();
        output.Insert(output.IndexOf(anchor) + 1, item);
        return output.ToArray();
    }
}
