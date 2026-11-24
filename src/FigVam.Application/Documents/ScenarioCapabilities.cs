using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Application.Documents;

public sealed record ScenarioCapabilitiesResponse(Guid DocumentId, long Revision, PortableUiProfileReference Profile, Guid NodeId, Guid? TargetId, Guid? ScreenId, Guid? VariantId, Guid? DatasetId, Guid? DemoNodeId, string? DemoValue, IReadOnlyList<PreviewEvent> Events, IReadOnlyList<string> Actions)
{
    public IReadOnlyList<string> PotentialActions { get; init; } = [];
    public IReadOnlyList<Guid> DemoTargetIds { get; init; } = [];
    public Guid? NavigationScreenId { get; init; }
    public Guid? DemoScreenId { get; init; }
}
public sealed record ScenarioCapabilitiesResult(string Code, ScenarioCapabilitiesResponse? Response = null);
public interface IScenarioCapabilitiesQuery
{
    Task<ScenarioCapabilitiesResult> ReadAsync(Guid documentId, long revision, Guid nodeId, Guid? targetId, Guid? screenId, Guid? variantId, Guid? datasetId, Guid? demoNodeId, string? demoValue, DocumentActor actor, CancellationToken ct = default, Guid? sourceScreenId = null, IReadOnlyList<PreviewAction>? prefix = null);
}
public sealed class ScenarioCapabilitiesQuery(IDocumentAuthorization authorization, IDocumentStateReader reader, INodeProfile installedProfile) : IScenarioCapabilitiesQuery
{
    public async Task<ScenarioCapabilitiesResult> ReadAsync(Guid documentId, long revision, Guid nodeId, Guid? targetId, Guid? screenId, Guid? variantId, Guid? datasetId, Guid? demoNodeId, string? demoValue, DocumentActor actor, CancellationToken ct = default, Guid? sourceScreenId = null, IReadOnlyList<PreviewAction>? prefix = null)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || nodeId == Guid.Empty || targetId == Guid.Empty || screenId == Guid.Empty || variantId == Guid.Empty || datasetId == Guid.Empty || demoNodeId == Guid.Empty || demoValue?.Length > 4096 || (variantId is not null && screenId is null) || revision < 0) return new("INVALID_QUERY");
        if (sourceScreenId == Guid.Empty || prefix?.Count > DocumentScenarioValidator.MaxActions || prefix?.Any(a => a is null) == true || prefix is not null && sourceScreenId is null) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        if (PortableUiProfileResolver.Resolve(state.Document.Profile, installedProfile, out var selected) is { } invalid) return new(invalid.Code);
        var profile = selected!;
        var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node is null) return new("NODE_NOT_FOUND");
        if (targetId is { } target && !state.Document.Screens.Any(s => s.Id == target)) return new("SCREEN_NOT_FOUND");
        var screen = state.Document.Screens.FirstOrDefault(s => s.Id == screenId);
        if (screenId is not null && screen is null) return new("SCREEN_NOT_FOUND");
        if (variantId is { } variant && !screen!.Variants.Any(v => v.Id == variant)) return new("SCREEN_VARIANT_NOT_FOUND");
        if (datasetId is { } dataset && !state.Document.Datasets.Any(d => d.Id == dataset)) return new("DATASET_NOT_FOUND");
        ScenarioActionContext? context = null;
        if (sourceScreenId is Guid sourceScreen)
        {
            if (!state.Document.Screens.Any(s => s.Id == sourceScreen)) return new("SCREEN_NOT_FOUND");
            context = new(sourceScreen);
            foreach (var action in prefix ?? [])
                if (profile.SupportsPreviewAction(action)) context.Advance(action);
        }
        var actions = new List<string>();
        if (demoNodeId is { } demoId && screen is not null)
        {
            var nodes = state.Document.Nodes.ToDictionary(n => n.Id);
            var members = new HashSet<Guid>();
            var pending = new Stack<Guid>(screen.ChildIds);
            while (pending.TryPop(out var member))
                if (members.Add(member) && nodes.TryGetValue(member, out var child))
                    foreach (var childId in child.ChildIds) pending.Push(childId);
            if (members.Contains(demoId) && nodes.TryGetValue(demoId, out var demoNode) && profile.SupportsDemoValue(demoNode.Kind) && profile.SupportsPreviewAction(new SetDemoValue(demoId, demoValue))) actions.Add("setDemoValue");
        }
        if (profile.SupportsPreviewAction(new SelectDataset(datasetId))) actions.Add("selectDataset");
        if (screen is not null && profile.SupportsPreviewAction(new ShowVariant(variantId))) actions.Add("showVariant");
        if (targetId is { } id)
        {
            if (profile.SupportsPreviewAction(new Navigate(id))) actions.Add("navigate");
            if (profile.SupportsPreviewAction(new OpenOverlay(id))) actions.Add("openOverlay");
        }
        if (profile.SupportsPreviewAction(new CloseOverlay())) actions.Add("closeOverlay");
        if (profile.SupportsPreviewAction(new ResetPreview())) actions.Add("resetPreview");
        return new("OK", new(documentId, state.Revision, profile.Identity, nodeId, targetId, screenId, variantId, datasetId, demoNodeId, demoValue,
            Enum.GetValues<PreviewEvent>().Where(e => profile.SupportsPreviewEvent(node.Kind, e)).ToArray(), actions)
        {
            PotentialActions = profile.PreviewActions,
            DemoTargetIds = state.Document.Nodes.Where(n => profile.SupportsDemoValue(n.Kind)).Select(n => n.Id).ToArray(),
            NavigationScreenId = context?.NavigationScreen,
            DemoScreenId = context?.DemoScreen
        });
    }
}
