using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record RevisionDiffItem(Guid Id, string Type, string Change, IReadOnlyList<string> ChangedProperties);
public sealed record RevisionDiffResponse(Guid DocumentId, long FromRevision, long ToRevision,
    IReadOnlyList<RevisionDiffItem> Items, int Offset, int Limit, int Total);
public sealed record RevisionDiffResult(string Code, RevisionDiffResponse? Response = null);
public interface IDocumentRevisionDiff
{
    Task<RevisionDiffResult> CompareAsync(Guid documentId, long fromRevision, long toRevision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentRevisionDiff(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentRevisionDiff
{
    public async Task<RevisionDiffResult> CompareAsync(Guid documentId, long fromRevision, long toRevision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (fromRevision < 0 || toRevision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var before = await reader.ReadAsync(documentId, fromRevision, ct);
        if (before.State is null) return new(before.Code);
        var after = await reader.ReadAsync(documentId, toRevision, ct);
        if (after.State is null) return new(after.Code);
        var old = Flatten(before.State.Document); var current = Flatten(after.State.Document);
        var changes = new List<RevisionDiffItem>();
        foreach (var key in old.Keys.Union(current.Keys).OrderBy(k => k.Type, StringComparer.Ordinal).ThenBy(k => k.Id))
        {
            if (!old.TryGetValue(key, out var left)) { changes.Add(new(key.Id, key.Type, "added", [])); continue; }
            if (!current.TryGetValue(key, out var right)) { changes.Add(new(key.Id, key.Type, "removed", [])); continue; }
            var names = left.Keys.Union(right.Keys).Where(n => !left.TryGetValue(n, out var a) || !right.TryGetValue(n, out var b) || !Equals(a, b)).Order(StringComparer.Ordinal).ToArray();
            if (names.Length != 0) changes.Add(new(key.Id, key.Type, "modified", names));
        }
        return new("OK", new(documentId, fromRevision, toRevision, changes.Skip(offset).Take(limit).ToArray(), offset, limit, changes.Count));
    }

    private static Dictionary<(string Type, Guid Id), Dictionary<string, object?>> Flatten(DocumentStructure doc)
    {
        var result = new Dictionary<(string, Guid), Dictionary<string, object?>>();
        for (var i = 0; i < doc.Pages.Count; i++)
        {
            var page = doc.Pages[i];
            result[("page", page.Id)] = new() { ["position"] = i, ["screenIds"] = string.Join(',', page.ScreenIds) };
        }
        for (var i = 0; i < doc.Screens.Count; i++)
        {
            var screen = doc.Screens[i];
            result[("screen", screen.Id)] = new() { ["position"] = i };
            foreach (var variant in screen.Variants)
            {
                var values = new Dictionary<string, object?> { ["screenId"] = screen.Id, ["name"] = variant.Name };
                foreach (var item in variant.Overrides) values["overrides." + item.NodeId + "." + item.Property] = item.Value;
                result[("screenVariant", variant.Id)] = values;
            }
        }
        foreach (var dataset in doc.Datasets)
            result[("dataset", dataset.Id)] = new() { ["name"] = dataset.Name, ["fixtureJson"] = dataset.FixtureJson };
        foreach (var node in doc.Nodes)
        {
            var values = new Dictionary<string, object?> { ["kind"] = node.Kind, ["name"] = node.Name, ["semanticKey"] = node.SemanticKey };
            foreach (var property in node.Properties) values["properties." + property.Key] = property.Value;
            values["repeater"] = System.Text.Json.JsonSerializer.Serialize(node.Repeater);
            foreach (var binding in node.DataBindings) values["dataBindings." + binding.Key] = System.Text.Json.JsonSerializer.Serialize(binding.Value);
            result[("node", node.Id)] = values;
        }
        void Children(Guid parent, IReadOnlyList<Guid> ids)
        {
            for (var i = 0; i < ids.Count; i++) { result[("node", ids[i])]["parentId"] = parent; result[("node", ids[i])]["position"] = i; }
        }
        foreach (var screen in doc.Screens) Children(screen.Id, screen.ChildIds);
        foreach (var node in doc.Nodes) Children(node.Id, node.ChildIds);
        return result;
    }
}
