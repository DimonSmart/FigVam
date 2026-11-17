using FigVam.Domain.Components;

namespace FigVam.Application.Documents;

public sealed record ComponentListResponse(Guid DocumentId, long Revision, IReadOnlyList<ComponentDefinition> Items, int Offset, int Limit, int Total);
public sealed record ComponentResponse(Guid DocumentId, long Revision, ComponentDefinition Component);
public sealed record ComponentUsagesResponse(Guid DocumentId, long Revision, Guid ComponentId, IReadOnlyList<ComponentInstance> Items, int Offset, int Limit, int Total);
public sealed record ComponentQueryResult<T>(string Code, T? Response = default) where T : class;

public interface IDocumentComponentQueries
{
    Task<ComponentQueryResult<ComponentListResponse>> ListAsync(Guid documentId, long? revision, string? search, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
    Task<ComponentQueryResult<ComponentResponse>> ReadAsync(Guid documentId, Guid componentId, long? revision, DocumentActor actor, CancellationToken ct = default);
    Task<ComponentQueryResult<ComponentUsagesResponse>> UsagesAsync(Guid documentId, Guid componentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentComponentQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentComponentQueries
{
    private async Task<DocumentStateReadResult> StateAsync(Guid documentId, Guid? componentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || componentId == Guid.Empty) return new("INVALID_ID");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        if (revision < 0) return new("INVALID_REVISION");
        return await reader.ReadAsync(documentId, revision, ct);
    }
    public async Task<ComponentQueryResult<ComponentListResponse>> ListAsync(Guid documentId, long? revision, string? search, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, null, revision, offset, limit, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        if (search is { Length: > 256 } || search?.Any(char.IsControl) == true) return new("INVALID_QUERY");
        var items = state.Document.ComponentDefinitions.Where(d => search is null || d.Name.Contains(search, StringComparison.OrdinalIgnoreCase))
            .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ThenBy(d => d.Name, StringComparer.Ordinal).ThenBy(d => d.Id).ToArray();
        return new("OK", new(documentId, state.Revision, items.Skip(offset).Take(limit).ToArray(), offset, limit, items.Length));
    }
    public async Task<ComponentQueryResult<ComponentResponse>> ReadAsync(Guid documentId, Guid componentId, long? revision, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, componentId, revision, 0, 1, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var component = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == componentId);
        return component is null ? new("COMPONENT_NOT_FOUND") : new("OK", new(documentId, state.Revision, component));
    }
    public async Task<ComponentQueryResult<ComponentUsagesResponse>> UsagesAsync(Guid documentId, Guid componentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, componentId, revision, offset, limit, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        if (!state.Document.ComponentDefinitions.Any(d => d.Id == componentId)) return new("COMPONENT_NOT_FOUND");
        var items = state.Document.ComponentInstances.Where(i => i.DefinitionId == componentId).OrderBy(i => i.NodeId).ToArray();
        return new("OK", new(documentId, state.Revision, componentId, items.Skip(offset).Take(limit).ToArray(), offset, limit, items.Length));
    }
}
