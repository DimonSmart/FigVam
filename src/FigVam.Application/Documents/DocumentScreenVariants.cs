using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record AddScreenVariantCommand(Guid DocumentId, Guid CommandId, Guid ScreenId, Guid VariantId, string Name);
public sealed record SetScreenVariantOverrideCommand(Guid DocumentId, Guid CommandId, Guid ScreenId, Guid VariantId, Guid NodeId, string Property, NodePropertyValue Value);
public sealed record RemoveScreenVariantOverrideCommand(Guid DocumentId, Guid CommandId, Guid ScreenId, Guid VariantId, Guid NodeId, string Property);
public sealed record ScreenVariantChanged(Guid ScreenId, ScreenVariant Variant, string Operation) : DocumentEvent;

public sealed partial class DocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(AddScreenVariantCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScreenVariant(c.DocumentId, c.CommandId, c.ScreenId, c.VariantId, c.Name, null, null, null, "ADD_SCREEN_VARIANT", actor, cancellationToken);
    public Task<CommandResult> HandleAsync(SetScreenVariantOverrideCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScreenVariant(c.DocumentId, c.CommandId, c.ScreenId, c.VariantId, null, c.NodeId, c.Property, c.Value, "SET_SCREEN_VARIANT_OVERRIDE", actor, cancellationToken);
    public Task<CommandResult> HandleAsync(RemoveScreenVariantOverrideCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScreenVariant(c.DocumentId, c.CommandId, c.ScreenId, c.VariantId, null, c.NodeId, c.Property, null, "REMOVE_SCREEN_VARIANT_OVERRIDE", actor, cancellationToken);

    private async Task<CommandResult> ChangeScreenVariant(Guid documentId, Guid commandId, Guid screenId, Guid variantId,
        string? name, Guid? nodeId, string? property, NodePropertyValue? value, string operation, DocumentActor actor, CancellationToken ct)
    {
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(documentId, commandId, code, revision,
            actor.Id, null, DateTimeOffset.UtcNow, ScreenId: screenId, NodeId: nodeId, Explanation: explanation, Property: property,
            AffectedIds: code == "ACCEPTED" ? new Guid?[] { screenId, variantId, nodeId }.OfType<Guid>().ToArray() : null);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (screenId == Guid.Empty || variantId == Guid.Empty || nodeId == Guid.Empty) return new(Result("INVALID_ID"), null);
            var screen = state.Document.Screens.FirstOrDefault(s => s.Id == screenId);
            if (screen is null) return new(Result("SCREEN_NOT_FOUND"), null);
            var variant = screen.Variants.FirstOrDefault(v => v.Id == variantId);
            if (operation == "ADD_SCREEN_VARIANT")
            {
                if (variant is not null) return new(Result("DUPLICATE_ID"), null);
                variant = new(variantId, name!, []);
            }
            else
            {
                if (variant is null) return new(Result("SCREEN_VARIANT_NOT_FOUND"), null);
                if (!state.Document.Nodes.Any(n => n.Id == nodeId)) return new(Result("NODE_NOT_FOUND"), null);
                if (string.IsNullOrWhiteSpace(property)) return new(Result("UNSUPPORTED_PROPERTY"), null);
                if (operation == "REMOVE_SCREEN_VARIANT_OVERRIDE" && !variant.Overrides.Any(o => o.NodeId == nodeId && o.Property == property)) return new(Result("VARIANT_OVERRIDE_NOT_FOUND"), null);
                if (operation == "SET_SCREEN_VARIANT_OVERRIDE" && value is null) return new(Result("INVALID_PROPERTY_TYPE"), null);
                var items = variant.Overrides.Where(o => o.NodeId != nodeId || o.Property != property).ToList();
                if (value is not null) items.Add(new(nodeId!.Value, property, value));
                variant = variant with { Overrides = items.OrderBy(o => o.NodeId).ThenBy(o => o.Property, StringComparer.Ordinal).ToArray() };
            }
            var changed = ScreenVariantEditor.Set(state.Document, screenId, variant);
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } invalid)
                return new(Result(invalid.Code == "duplicate-id" ? "DUPLICATE_ID" : invalid.Code, explanation: invalid.Message), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ScreenVariantChanged(screenId, variant, operation));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }
}

public sealed record ScreenVariantsResponse(Guid DocumentId, long Revision, Guid ScreenId, IReadOnlyList<ScreenVariant> Items, int Offset, int Limit, int Total);
public sealed record ScreenVariantsResult(string Code, ScreenVariantsResponse? Response = null);
public interface IDocumentScreenVariantQueries
{
    Task<ScreenVariantsResult> ReadAsync(Guid documentId, Guid screenId, Guid? variantId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}
public sealed class DocumentScreenVariantQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentScreenVariantQueries
{
    public async Task<ScreenVariantsResult> ReadAsync(Guid documentId, Guid screenId, Guid? variantId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || screenId == Guid.Empty || variantId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        var screen = state.Document.Screens.FirstOrDefault(s => s.Id == screenId);
        if (screen is null) return new("SCREEN_NOT_FOUND");
        var items = screen.Variants.Where(v => variantId is null || v.Id == variantId).ToArray();
        if (variantId is not null && items.Length == 0) return new("SCREEN_VARIANT_NOT_FOUND");
        return new("OK", new(documentId, state.Revision, screenId, items.Skip(offset).Take(limit).ToArray(), offset, limit, items.Length));
    }
}
