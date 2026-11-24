using FigVam.Domain.Preview;

namespace FigVam.Domain.Documents;

public static class DocumentScenarioEditor
{
    public static DocumentStructure Set(DocumentStructure document, Guid id, PreviewScenario? scenario)
        => document with { Scenarios = scenario is null ? document.Scenarios.Where(s => s.Id != id).ToArray()
            : document.Scenarios.Any(s => s.Id == id) ? document.Scenarios.Select(s => s.Id == id ? scenario : s).ToArray() : [.. document.Scenarios, scenario] };
}

public sealed class ScenarioActionContext(Guid sourceScreen)
{
    private readonly Stack<Guid> overlays = new();
    public Guid? NavigationScreen { get; private set; } = sourceScreen;
    public Guid? DemoScreen => overlays.TryPeek(out var top) ? top : NavigationScreen;

    public void Advance(PreviewAction action)
    {
        switch (action)
        {
            case Navigate a: NavigationScreen = a.ScreenId; overlays.Clear(); break;
            case OpenOverlay a: overlays.Push(a.ScreenId); break;
            case CloseOverlay:
                if (overlays.Count > 0) overlays.Pop();
                else NavigationScreen = null;
                break;
            case ResetPreview: NavigationScreen = null; overlays.Clear(); break;
        }
    }
}

public static class DocumentScenarioValidator
{
    public const int MaxScenarios = 1000;
    public const int MaxActions = 32;
    public static IReadOnlyList<StructureError> Validate(DocumentStructure document, INodeProfile profile)
    {
        var errors = new List<StructureError>();
        if (document.Scenarios.Count > MaxScenarios) errors.Add(new("INVALID_SCENARIO", document.Id, null, "At most 1000 scenarios are allowed."));
        var nodes = document.Nodes.GroupBy(n => n.Id).ToDictionary(g => g.Key, g => g.First());
        HashSet<Guid> Members(Guid screenId)
        {
            var found = new HashSet<Guid>();
            var stack = new Stack<Guid>(document.Screens.FirstOrDefault(s => s.Id == screenId)?.ChildIds ?? []);
            while (stack.TryPop(out var id)) if (found.Add(id) && nodes.TryGetValue(id, out var node)) foreach (var child in node.ChildIds) stack.Push(child);
            return found;
        }
        foreach (var scenario in document.Scenarios)
        {
            void Error(Guid? reference, string reason) => errors.Add(new("INVALID_SCENARIO", scenario.Id, reference, reason));
            bool Screen(Guid id) => document.Screens.Any(s => s.Id == id);
            if (!Screen(scenario.ScreenId)) Error(scenario.ScreenId, "Scenario screen must exist.");
            if (!Members(scenario.ScreenId).Contains(scenario.NodeId) || !nodes.TryGetValue(scenario.NodeId, out var trigger)) Error(scenario.NodeId, "Event node must belong to the scenario screen.");
            else if (!Enum.IsDefined(scenario.Event) || !profile.SupportsPreviewEvent(trigger.Kind, scenario.Event)) Error(scenario.NodeId, "Event is not supported by the node profile.");
            if (scenario.Actions is null || scenario.Actions.Count is < 1 or > MaxActions) { Error(null, "A scenario requires 1-32 actions."); continue; }
            var context = new ScenarioActionContext(scenario.ScreenId);
            foreach (var action in scenario.Actions)
            {
                if (action is null || !profile.SupportsPreviewAction(action)) { Error(null, "Action is not supported by the profile."); continue; }
                switch (action)
                {
                    case Navigate a:
                        if (!Screen(a.ScreenId)) Error(a.ScreenId, "Navigation target must be a screen.");
                        break;
                    case OpenOverlay a:
                        if (!Screen(a.ScreenId)) Error(a.ScreenId, "Overlay target must be a screen.");
                        break;
                    case ShowVariant { VariantId: Guid id }:
                        if (!document.Screens.Any(s => (context.NavigationScreen is null || s.Id == context.NavigationScreen) && s.Variants.Any(v => v.Id == id))) Error(id, "Variant must belong to the navigation screen at this action.");
                        break;
                    case SetDemoValue a:
                        if (!(context.DemoScreen is Guid active ? Members(active).Contains(a.NodeId) : document.Screens.Any(s => Members(s.Id).Contains(a.NodeId))) || !nodes.TryGetValue(a.NodeId, out var target) || !profile.SupportsDemoValue(target.Kind)) Error(a.NodeId, "Demo value target must be an eligible node on the active screen.");
                        if (a.Value?.Length > 4096) Error(a.NodeId, "Demo values are limited to 4096 characters.");
                        break;
                    case SelectDataset { DatasetId: Guid id }:
                        if (!document.Datasets.Any(d => d.Id == id)) Error(id, "Dataset must exist."); break;
                    case CloseOverlay or ResetPreview: break;
                    case ShowVariant or SelectDataset: break;
                    default: Error(null, "Unknown action."); break;
                }
                context.Advance(action);
            }
        }
        if (errors.Count == 0 && System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(document.Scenarios).Length > 1024 * 1024)
            errors.Add(new("INVALID_SCENARIO", document.Id, null, "Saved scenarios are limited to 1 MiB of JSON."));
        return errors;
    }
}
