using System.Text.Json;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Domain.Components;

namespace FigVam.Application.Documents;

public sealed record UndoDocumentCommand(Guid DocumentId, Guid CommandId);
public sealed record RedoDocumentCommand(Guid DocumentId, Guid CommandId);
public sealed record EntityChange<T>(Guid Id, T? Before, T? After, int BeforeIndex, int AfterIndex, bool Reorder = false) where T : class;

// Only changed entities are carried; unrelated current entities are preserved.
public sealed record DocumentPatch(IReadOnlyList<EntityChange<PageStructure>> Pages,
    IReadOnlyList<EntityChange<ScreenStructure>> Screens, IReadOnlyList<EntityChange<NodeStructure>> Nodes)
{
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<DocumentDataset>> Datasets { get; init; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<DesignToken>> Tokens { get; init; } = [];

    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<ComponentDefinition>> ComponentDefinitions { get; init; } = [];

    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<ComponentInstance>> ComponentInstances { get; init; } = [];

    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<FigVam.Domain.Preview.PreviewScenario>> Scenarios { get; init; } = [];

    [System.Text.Json.Serialization.JsonRequired]
    public IReadOnlyList<EntityChange<DocumentAsset>> Assets { get; init; } = [];

    public sealed record NameChange(string Before, string After);
    [System.Text.Json.Serialization.JsonRequired]
    public NameChange? Name { get; init; }

    public static DocumentPatch Between(DocumentStructure before, DocumentStructure after) => new(
        Diff(before.Pages, after.Pages, p => p.Id), Diff(before.Screens, after.Screens, s => s.Id),
        Diff(before.Nodes, after.Nodes, n => n.Id)) { Name = before.Name == after.Name ? null : new(before.Name, after.Name), Assets = Diff(before.Assets, after.Assets, a => a.Id), Scenarios = Diff(before.Scenarios, after.Scenarios, s => s.Id), Datasets = Diff(before.Datasets, after.Datasets, d => d.Id), Tokens = Diff(before.Tokens, after.Tokens, t => t.Id), ComponentInstances = Diff(before.ComponentInstances, after.ComponentInstances, i => i.NodeId), ComponentDefinitions = Diff(before.ComponentDefinitions, after.ComponentDefinitions, d => d.Id) };

    private static bool Equal<T>(T? left, T? right) => JsonSerializer.Serialize(left) == JsonSerializer.Serialize(right);
    private static EntityChange<T>[] Diff<T>(IReadOnlyList<T> before, IReadOnlyList<T> after, Func<T, Guid> id) where T : class
    {
        var beforeIds = before.Select(id).ToArray();
        var afterIds = after.Select(id).ToArray();
        var common = beforeIds.Intersect(afterIds).ToHashSet();
        var reordered = !beforeIds.Where(common.Contains).SequenceEqual(afterIds.Where(common.Contains));
        return beforeIds.Union(afterIds).Select(key => new EntityChange<T>(key,
            before.FirstOrDefault(x => id(x) == key), after.FirstOrDefault(x => id(x) == key),
            Array.IndexOf(beforeIds, key), Array.IndexOf(afterIds, key), reordered && common.Contains(key)))
            .Where(change => change.Reorder || !Equal(change.Before, change.After)).ToArray();
    }

    public DocumentPatch Reverse() => new(Reverse(Pages), Reverse(Screens), Reverse(Nodes)) { Name = Name is null ? null : new(Name.After, Name.Before), Assets = Reverse(Assets), Scenarios = Reverse(Scenarios), Datasets = Reverse(Datasets), Tokens = Reverse(Tokens), ComponentInstances = Reverse(ComponentInstances), ComponentDefinitions = Reverse(ComponentDefinitions) };
    private static EntityChange<T>[] Reverse<T>(IReadOnlyList<EntityChange<T>> changes) where T : class
        => changes.Select(c => new EntityChange<T>(c.Id, c.After, c.Before, c.AfterIndex, c.BeforeIndex, c.Reorder)).ToArray();

    public DocumentStructure? Apply(DocumentStructure current)
    {
        if (Name is not null && current.Name != Name.Before) return null;
        var assets = Apply(current.Assets, Assets, a => a.Id);
        var pages = Apply(current.Pages, Pages, p => p.Id);
        var screens = Apply(current.Screens, Screens, s => s.Id);
        var nodes = Apply(current.Nodes, Nodes, n => n.Id);
        var scenarios = Apply(current.Scenarios, Scenarios, s => s.Id);
        var datasets = Apply(current.Datasets, Datasets, d => d.Id);
        var tokens = Apply(current.Tokens, Tokens, t => t.Id);
        var instances = Apply(current.ComponentInstances, ComponentInstances, i => i.NodeId);
        var components = Apply(current.ComponentDefinitions, ComponentDefinitions, d => d.Id);
        return assets is null || scenarios is null || datasets is null || instances is null || components is null || tokens is null || pages is null || screens is null || nodes is null ? null : current with { Name = Name?.After ?? current.Name, Assets = assets, Scenarios = scenarios, Datasets = datasets, Pages = pages, Screens = screens, Nodes = nodes, Tokens = tokens, ComponentDefinitions = components, ComponentInstances = instances };
    }
    private static T[]? Apply<T>(IReadOnlyList<T> current, IReadOnlyList<EntityChange<T>> changes, Func<T, Guid> id) where T : class
    {
        if (changes.Any(c => !Equal(current.FirstOrDefault(x => id(x) == c.Id), c.Before) ||
            (c.Reorder && current.ToList().FindIndex(x => id(x) == c.Id) != c.BeforeIndex))) return null;
        var result = current.ToList();
        foreach (var c in changes.Where(c => c.Before is not null))
        {
            var index = result.FindIndex(x => id(x) == c.Id);
            if (c.After is null || c.Reorder) result.RemoveAt(index); else result[index] = c.After;
        }
        foreach (var c in changes.Where(c => (c.Before is null || c.Reorder) && c.After is not null).OrderBy(c => c.AfterIndex))
            result.Insert(Math.Min(c.AfterIndex, result.Count), c.After!);
        return result.ToArray();
    }
}

public sealed record HistoryCompensated(Guid TargetCommandId, bool IsRedo, DocumentPatch Patch) : DocumentEvent;
public sealed record DocumentCommandHistoryEntry(CommandResult Result, string Type, DocumentPatch? Patch,
    string Status, long HistoryOrder);
public sealed record DocumentCommandHistoryResult(string Code, IReadOnlyList<DocumentCommandHistoryEntry>? Entries = null);
public interface IDocumentCommandHistoryStore
{
    Task<DocumentCommandHistoryResult> ReadHistoryAsync(Guid documentId, string actorId, CancellationToken cancellationToken = default);
}
public sealed class DocumentCommandHistoryReader(IDocumentAuthorization authorization, IDocumentCommandHistoryStore store)
{
    public async Task<DocumentCommandHistoryResult> ReadAsync(Guid documentId, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        return await store.ReadHistoryAsync(documentId, actor.Id, cancellationToken);
    }
}
