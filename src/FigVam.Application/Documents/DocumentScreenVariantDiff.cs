using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record ScreenVariantDifference(Guid NodeId, string Property);
public sealed record ScreenVariantDiffResponse(Guid DocumentId, long Revision, Guid ScreenId, Guid? FromVariantId, Guid? ToVariantId, IReadOnlyList<ScreenVariantDifference> Items, int Offset, int Limit, int Total);
public sealed record ScreenVariantDiffResult(string Code, ScreenVariantDiffResponse? Response = null);

public interface IDocumentScreenVariantDiff
{
    Task<ScreenVariantDiffResult> CompareAsync(Guid documentId, Guid screenId, Guid? fromVariantId, Guid? toVariantId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentScreenVariantDiff(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentScreenVariantDiff
{
    public async Task<ScreenVariantDiffResult> CompareAsync(Guid documentId, Guid screenId, Guid? fromVariantId, Guid? toVariantId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || screenId == Guid.Empty || fromVariantId == Guid.Empty || toVariantId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        var screen = state.Document.Screens.FirstOrDefault(s => s.Id == screenId);
        if (screen is null) return new("SCREEN_NOT_FOUND");
        var from = screen.Variants.FirstOrDefault(v => v.Id == fromVariantId);
        var to = screen.Variants.FirstOrDefault(v => v.Id == toVariantId);
        if ((fromVariantId is not null && from is null) || (toVariantId is not null && to is null)) return new("SCREEN_VARIANT_NOT_FOUND");
        var nodes = state.Document.Nodes.ToDictionary(n => n.Id);
        var candidates = (from?.Overrides ?? []).Concat(to?.Overrides ?? [])
            .Select(o => (o.NodeId, o.Property)).Distinct().OrderBy(x => x.NodeId).ThenBy(x => x.Property, StringComparer.Ordinal);
        NodePropertyValue? Resolve(ScreenVariant? variant, NodeStructure node, string property) => variant is null
            ? node.Properties.GetValueOrDefault(property) : ScreenVariantEditor.ResolveProperty(variant, node, property);
        var differences = candidates.Where(x => nodes.TryGetValue(x.NodeId, out var node) && !Equals(Resolve(from, node, x.Property), Resolve(to, node, x.Property)))
            .Select(x => new ScreenVariantDifference(x.NodeId, x.Property)).ToArray();
        return new("OK", new(documentId, state.Revision, screenId, fromVariantId, toVariantId, differences.Skip(offset).Take(limit).ToArray(), offset, limit, differences.Length));
    }
}
