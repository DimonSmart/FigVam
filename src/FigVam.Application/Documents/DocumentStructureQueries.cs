using System.Text.Json.Serialization;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public interface IDocumentStateReader
{
    Task<DocumentStateReadResult> ReadAsync(Guid documentId, long? revision, CancellationToken cancellationToken = default);
}

public sealed record DocumentStateReadResult(string Code, DocumentState? State = null);

public sealed record StructureQuery(string Resource, Guid? ObjectId = null, int Offset = 0, int Limit = 50,
    int Depth = 0, string? Fields = null, Guid? ScreenId = null, string? Kind = null, string? SemanticKey = null, string? NamePrefix = null, long? Revision = null);
public sealed record StructureItem(Guid Id, string Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Kind = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, NodePropertyValue>? Properties = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<StructureItem>? Children = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? ChildCount = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? ChildrenTruncated = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Name = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SemanticKey = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, NodeDataBinding>? DataBindings = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] NodeRepeater? Repeater = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ScreenDimensions? Dimensions = null);
public sealed record StructureResponse(Guid DocumentId, long Revision, IReadOnlyList<StructureItem> Items,
    int Offset, int Limit, int Total);
public sealed record StructureQueryResult(string Code, StructureResponse? Response = null);

public interface IDocumentStructureQueries
{
    Task<StructureQueryResult> QueryAsync(Guid documentId, StructureQuery query, DocumentActor actor, CancellationToken cancellationToken = default);
}

public sealed class DocumentStructureQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentStructureQueries
{
    public async Task<StructureQueryResult> QueryAsync(Guid documentId, StructureQuery query, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || query.ObjectId == Guid.Empty || query.ScreenId == Guid.Empty) return new("INVALID_ID");
        var fields = query.Fields is null ? new HashSet<string>(["kind", "properties", "childCount", "name", "semanticKey", "dataBindings", "repeater", "dimensions"], StringComparer.Ordinal) : query.Fields.Split(',').ToHashSet(StringComparer.Ordinal);
        if (query.Offset < 0 || query.Limit is < 1 or > 100 || query.Depth is < 0 or > 2 || fields.Any(f => f is not ("kind" or "properties" or "childCount" or "name" or "semanticKey" or "dataBindings" or "repeater" or "dimensions")) || query.Kind?.Length > 256 || query.SemanticKey?.Length > 256 || query.NamePrefix?.Length > 256)
            return new("INVALID_QUERY");
        if (query.ScreenId is not null && query.Resource != "nodes" || (query.Kind is not null || query.SemanticKey is not null || query.NamePrefix is not null) && query.Resource is not ("nodes" or "children")) return new("INVALID_QUERY");
        if (query.Revision < 0) return new("INVALID_REVISION");
        var read = await reader.ReadAsync(documentId, query.Revision, cancellationToken);
        if (read.State is not { } state) return new(read.Code);
        var doc = state.Document;
        var nodes = doc.Nodes.ToDictionary(n => n.Id);
        var screens = doc.Screens.ToDictionary(s => s.Id);
        IEnumerable<Guid> Descendants(Guid screenId)
        {
            var pending = new Stack<Guid>(screens[screenId].ChildIds.Reverse());
            while (pending.TryPop(out var id)) { yield return id; foreach (var child in nodes[id].ChildIds.Reverse()) pending.Push(child); }
        }
        if (query.ScreenId is { } screen && !screens.ContainsKey(screen)) return new("SCREEN_NOT_FOUND");
        bool Matches(NodeStructure n) => (query.Kind is null || n.Kind == query.Kind) &&
            (query.SemanticKey is null || n.SemanticKey == query.SemanticKey) &&
            (query.NamePrefix is null || n.Name.StartsWith(query.NamePrefix, StringComparison.Ordinal));
        IEnumerable<(Guid Id, string Type)> items;
        switch (query.Resource)
        {
            case "document": items = [(doc.Id, "document")]; break;
            case "pages": items = doc.Pages.Select(p => (p.Id, "page")); break;
            case "page": if (!doc.Pages.Any(p => p.Id == query.ObjectId)) return new("PAGE_NOT_FOUND"); items = [(query.ObjectId!.Value, "page")]; break;
            case "page-screens":
                var page = doc.Pages.FirstOrDefault(p => p.Id == query.ObjectId);
                if (page is null) return new("PAGE_NOT_FOUND");
                items = page.ScreenIds.Select(id => (id, "screen")); break;
            case "screens": items = doc.Screens.Select(s => (s.Id, "screen")); break;
            case "screen": if (!screens.ContainsKey(query.ObjectId!.Value)) return new("SCREEN_NOT_FOUND"); items = [(query.ObjectId.Value, "screen")]; break;
            case "nodes": items = (query.ScreenId is { } sid ? Descendants(sid).Select(id => nodes[id]) : doc.Nodes).Where(Matches).Select(n => (n.Id, "node")); break;
            case "node": if (!nodes.ContainsKey(query.ObjectId!.Value)) return new("NODE_NOT_FOUND"); items = [(query.ObjectId.Value, "node")]; break;
            case "children":
                if (screens.TryGetValue(query.ObjectId!.Value, out var s)) items = s.ChildIds.Select(id => (id, "node"));
                else if (nodes.TryGetValue(query.ObjectId.Value, out var n)) items = n.ChildIds.Select(id => (id, "node"));
                else return new("PARENT_NOT_FOUND");
                items = items.Where(x => Matches(nodes[x.Id])); break;
            default: return new("INVALID_QUERY");
        }
        var all = items.ToArray();
        // Expansion is bounded independently of tree width; use children pagination for larger trees.
        var resultPage = all.Skip(query.Offset).Take(query.Limit).ToArray();
        var budget = 100 - resultPage.Length;
        StructureItem Project((Guid Id, string Type) item, int depth)
        {

            var ids = item.Type switch { "document" => doc.Pages.Select(p => p.Id).ToArray(), "page" => doc.Pages.First(p => p.Id == item.Id).ScreenIds.ToArray(), "screen" => screens[item.Id].ChildIds.ToArray(), _ => nodes[item.Id].ChildIds.ToArray() };
            var childType = item.Type switch { "document" => "page", "page" => "screen", _ => "node" };
            IReadOnlyList<StructureItem>? children = null;
            if (depth > 0)
            {
                var expanded = new List<StructureItem>();
                foreach (var id in ids)
                {
                    if (budget == 0) break;
                    budget--;
                    expanded.Add(Project((id, childType), depth - 1));
                }
                children = expanded;
            }
            var node = item.Type == "node" ? nodes[item.Id] : null;
            return new(item.Id, item.Type, fields.Contains("kind") ? node?.Kind : null, fields.Contains("properties") ? node?.Properties : null, children, fields.Contains("childCount") ? ids.Length : null, children is not null && children.Count < ids.Length ? true : null, fields.Contains("name") ? (item.Type == "document" ? doc.Name : item.Type == "page" ? doc.Pages.First(p => p.Id == item.Id).Name : node?.Name) : null, fields.Contains("semanticKey") ? node?.SemanticKey : null, fields.Contains("dataBindings") ? node?.DataBindings : null, fields.Contains("repeater") ? node?.Repeater : null, fields.Contains("dimensions") && item.Type == "screen" ? screens[item.Id].Dimensions : null);
        }
        return new("OK", new(documentId, state.Revision, resultPage.Select(x => Project(x, query.Depth)).ToArray(), query.Offset, query.Limit, all.Length));
    }
}


