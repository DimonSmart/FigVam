using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Application.Documents;

public sealed record ScenarioCapabilitiesResponse(Guid DocumentId, long Revision, PortableUiProfileReference Profile, Guid NodeId, Guid? TargetId, Guid? ScreenId, Guid? VariantId, IReadOnlyList<PreviewEvent> Events, IReadOnlyList<string> Actions);
public sealed record ScenarioCapabilitiesResult(string Code, ScenarioCapabilitiesResponse? Response = null);
public interface IScenarioCapabilitiesQuery
{
    Task<ScenarioCapabilitiesResult> ReadAsync(Guid documentId, long revision, Guid nodeId, Guid? targetId, Guid? screenId, Guid? variantId, DocumentActor actor, CancellationToken ct = default);
}
public sealed class ScenarioCapabilitiesQuery(IDocumentAuthorization authorization, IDocumentStateReader reader, INodeProfile profile) : IScenarioCapabilitiesQuery
{
    public async Task<ScenarioCapabilitiesResult> ReadAsync(Guid documentId, long revision, Guid nodeId, Guid? targetId, Guid? screenId, Guid? variantId, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || nodeId == Guid.Empty || targetId == Guid.Empty || screenId == Guid.Empty || variantId == Guid.Empty || (variantId is not null && screenId is null) || revision < 0) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        if (PortableUiProfileResolver.Validate(state.Document.Profile, profile) is { } invalid) return new(invalid.Code);
        var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node is null) return new("NODE_NOT_FOUND");
        if (targetId is { } target && !state.Document.Screens.Any(s => s.Id == target)) return new("SCREEN_NOT_FOUND");
        var screen = state.Document.Screens.FirstOrDefault(s => s.Id == screenId);
        if (screenId is not null && screen is null) return new("SCREEN_NOT_FOUND");
        if (variantId is { } variant && !screen!.Variants.Any(v => v.Id == variant)) return new("SCREEN_VARIANT_NOT_FOUND");
        var actions = new List<string>();
        if (screen is not null && profile.SupportsPreviewAction(new ShowVariant(variantId))) actions.Add("showVariant");
        if (targetId is { } id)
        {
            if (profile.SupportsPreviewAction(new Navigate(id))) actions.Add("navigate");
            if (profile.SupportsPreviewAction(new OpenOverlay(id))) actions.Add("openOverlay");
        }
        if (profile.SupportsPreviewAction(new CloseOverlay())) actions.Add("closeOverlay");
        if (profile.SupportsPreviewAction(new ResetPreview())) actions.Add("resetPreview");
        return new("OK", new(documentId, state.Revision, profile.Identity, nodeId, targetId, screenId, variantId,
            Enum.GetValues<PreviewEvent>().Where(e => profile.SupportsPreviewEvent(node.Kind, e)).ToArray(), actions));
    }
}
