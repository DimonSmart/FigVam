using FigVam.Domain.Tokens;

namespace FigVam.Domain.Preview;

public enum PreviewEvent { Click, Change, Hover, Leave }
public sealed record PreviewVariant(Guid Id, Guid ScreenId);
public sealed record PreviewScreen(Guid Id, IReadOnlyList<Guid> NodeIds);
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record PreviewScenario(
    [property: System.Text.Json.Serialization.JsonRequired] Guid Id,
    [property: System.Text.Json.Serialization.JsonRequired] Guid ScreenId,
    [property: System.Text.Json.Serialization.JsonRequired] Guid NodeId,
    [property: System.Text.Json.Serialization.JsonRequired] PreviewEvent Event,
    [property: System.Text.Json.Serialization.JsonRequired] IReadOnlyList<PreviewAction> Actions);
[System.Text.Json.Serialization.JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(Navigate), "navigate")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ShowVariant), "showVariant")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(SetDemoValue), "setDemoValue")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(SelectDataset), "selectDataset")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(OpenOverlay), "openOverlay")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(CloseOverlay), "closeOverlay")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ResetPreview), "resetPreview")]
public abstract record PreviewAction;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record Navigate([property: System.Text.Json.Serialization.JsonRequired] Guid ScreenId) : PreviewAction;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ShowVariant([property: System.Text.Json.Serialization.JsonRequired] Guid? VariantId) : PreviewAction;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record SetDemoValue([property: System.Text.Json.Serialization.JsonRequired] Guid NodeId, [property: System.Text.Json.Serialization.JsonRequired] string? Value) : PreviewAction;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record SelectDataset([property: System.Text.Json.Serialization.JsonRequired] Guid? DatasetId) : PreviewAction;
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record OpenOverlay([property: System.Text.Json.Serialization.JsonRequired] Guid ScreenId) : PreviewAction;
public sealed record CloseOverlay : PreviewAction;
public sealed record ResetPreview : PreviewAction;
public sealed record PreviewViewport(double Width, double Height);
public sealed record PreviewSelection(Guid ScreenId, Guid? VariantId, Guid? DatasetId, TokenTheme Theme, PreviewViewport Viewport);
public sealed record PreviewDefinition(IReadOnlyList<PreviewScreen> Screens, IReadOnlyList<PreviewVariant> Variants,
    IReadOnlyList<Guid> DatasetIds, IReadOnlyList<PreviewScenario> Scenarios, PreviewSelection InitialSelection);
public sealed record PreviewDiagnostic(string Code, Guid ObjectId, Guid? ReferenceId, string Message);

public static class PreviewValidator
{
    public static IReadOnlyList<PreviewDiagnostic> Validate(PreviewDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        var errors = new List<PreviewDiagnostic>();
        var kinds = new Dictionary<Guid, string>();
        void Register(Guid id, string kind)
        {
            if (id == Guid.Empty) errors.Add(new("empty-id", id, null, $"{kind} ID must be nonempty."));
            if (!kinds.TryAdd(id, kind)) errors.Add(new("duplicate-id", id, null, "ID must identify one object."));
        }
        foreach (var screen in definition.Screens) { Register(screen.Id, "screen"); foreach (var node in screen.NodeIds) Register(node, "node"); }
        foreach (var variant in definition.Variants) Register(variant.Id, "variant");
        foreach (var id in definition.DatasetIds) Register(id, "dataset");
        foreach (var scenario in definition.Scenarios) Register(scenario.Id, "scenario");
        void Reference(Guid owner, Guid id, string expected)
        {
            if (!kinds.TryGetValue(id, out var actual)) errors.Add(new("missing-reference", owner, id, $"Referenced {expected} does not exist."));
            else if (actual != expected) errors.Add(new("wrong-reference-type", owner, id, $"Expected {expected}, found {actual}."));
        }
        var selection = definition.InitialSelection;
        Reference(Guid.Empty, selection.ScreenId, "screen");
        if (selection.VariantId is Guid v) Reference(Guid.Empty, v, "variant");
        if (selection.DatasetId is Guid d) Reference(Guid.Empty, d, "dataset");
        if (!Enum.IsDefined(selection.Theme)) errors.Add(new("invalid-theme", Guid.Empty, null, "Theme is not supported."));
        foreach (var variant in definition.Variants) Reference(variant.Id, variant.ScreenId, "screen");
        if (selection.VariantId is Guid variantId && definition.Variants.FirstOrDefault(v => v.Id == variantId) is { } selectedVariant && selectedVariant.ScreenId != selection.ScreenId)
            errors.Add(new("variant-screen-mismatch", selection.ScreenId, variantId, "Variant must belong to the selected screen."));
        if (selection.Viewport is null || !double.IsFinite(selection.Viewport.Width) || !double.IsFinite(selection.Viewport.Height) || selection.Viewport.Width <= 0 || selection.Viewport.Height <= 0)
            errors.Add(new("invalid-viewport", Guid.Empty, null, "Viewport dimensions must be finite and positive."));
        foreach (var scenario in definition.Scenarios)
        {
            Reference(scenario.Id, scenario.ScreenId, "screen"); Reference(scenario.Id, scenario.NodeId, "node");
            if (definition.Screens.FirstOrDefault(s => s.Id == scenario.ScreenId) is { } screen && !screen.NodeIds.Contains(scenario.NodeId))
                errors.Add(new("node-screen-mismatch", scenario.Id, scenario.NodeId, "Event node must belong to its screen."));
            if (!Enum.IsDefined(scenario.Event)) errors.Add(new("invalid-event", scenario.Id, null, "Event is not supported."));
            if (scenario.Actions is null || scenario.Actions.Count is < 1 or > 32)
            {
                errors.Add(new("invalid-actions", scenario.Id, null, "Scenario requires 1-32 actions."));
                continue;
            }
            foreach (var action in scenario.Actions)
                switch (action)
                {
                    case Navigate a: Reference(scenario.Id, a.ScreenId, "screen"); break;
                    case ShowVariant { VariantId: Guid id }: Reference(scenario.Id, id, "variant"); break;
                    case SetDemoValue a: Reference(scenario.Id, a.NodeId, "node"); break;
                    case SelectDataset { DatasetId: Guid id }: Reference(scenario.Id, id, "dataset"); break;
                    case OpenOverlay a: Reference(scenario.Id, a.ScreenId, "screen"); break;
                    case ShowVariant or SelectDataset or CloseOverlay or ResetPreview: break;
                    default: errors.Add(new("invalid-action", scenario.Id, null, "Action is not supported.")); break;
                }
        }
        return errors;
    }
}

public sealed class PreviewSession
{
    private sealed record Snapshot(PreviewSelection Selection, IReadOnlyDictionary<Guid, string?> Values, IReadOnlyList<Guid> Overlays);
    private readonly PreviewDefinition definition;
    private readonly Snapshot initial;
    private readonly Snapshot current;
    private readonly IReadOnlyList<Snapshot> history;
    private PreviewSession(PreviewDefinition definition, Snapshot initial, Snapshot current, IReadOnlyList<Snapshot> history)
        => (this.definition, this.initial, this.current, this.history) = (definition, initial, current, history);
    public PreviewSelection Selection => current.Selection;
    public IReadOnlyDictionary<Guid, string?> Values => current.Values;
    public IReadOnlyList<Guid> Overlays => current.Overlays;
    public bool CanGoBack => history.Count > 0;

    public static PreviewSession Start(PreviewDefinition definition)
    {
        var errors = PreviewValidator.Validate(definition);
        if (errors.Count > 0) throw new InvalidOperationException(string.Join("; ", errors.Select(e => $"{e.Code}: {e.Message} ({e.ReferenceId})")));
        var copy = definition with
        {
            Screens = Array.AsReadOnly(definition.Screens.Select(s => s with { NodeIds = Array.AsReadOnly(s.NodeIds.ToArray()) }).ToArray()),
            Variants = Array.AsReadOnly(definition.Variants.ToArray()), DatasetIds = Array.AsReadOnly(definition.DatasetIds.ToArray()),
            Scenarios = Array.AsReadOnly(definition.Scenarios.Select(s => s with { Actions = Array.AsReadOnly(s.Actions.ToArray()) }).ToArray())
        };
        var start = new Snapshot(copy.InitialSelection, EmptyValues(), Array.AsReadOnly(Array.Empty<Guid>()));
        return new(copy, start, start, []);
    }
    public PreviewSession Select(PreviewSelection selection)
    {
        var errors = PreviewValidator.Validate(definition with { InitialSelection = selection });
        if (errors.Count > 0) throw new InvalidOperationException(string.Join("; ", errors.Select(e => $"{e.Code}: {e.Message}")));
        return Commit(current with { Selection = selection, Overlays = selection.ScreenId == current.Selection.ScreenId ? current.Overlays : Array.AsReadOnly(Array.Empty<Guid>()) });
    }
    public PreviewSession Trigger(Guid nodeId, PreviewEvent @event)
    {
        if (!Enum.IsDefined(@event)) throw new ArgumentOutOfRangeException(nameof(@event));
        var screenId = current.Overlays.Count > 0 ? current.Overlays[^1] : current.Selection.ScreenId;
        var screen = definition.Screens.Single(s => s.Id == screenId);
        if (!screen.NodeIds.Contains(nodeId)) throw new InvalidOperationException("Event node is not on the active screen.");
        var scenarios = definition.Scenarios.Where(s => s.ScreenId == screen.Id && s.NodeId == nodeId && s.Event == @event).ToArray();
        if (scenarios.Length == 0) return this;
        var next = current;
        foreach (var action in scenarios.SelectMany(s => s.Actions))
        {
            ValidateAction(next, action);
            next = Apply(next, action);
        }
        return Commit(next);
    }
    public PreviewSession Back() => history.Count == 0 ? this : new(definition, initial, history[^1], history.Take(history.Count - 1).ToArray());
    public PreviewSession Reset() => new(definition, initial, initial, []);
    public PreviewSession RestartFlow() => Reset();
    private PreviewSession Commit(Snapshot next) => new(definition, initial, next, [.. history, current]);
    private Snapshot Apply(Snapshot state, PreviewAction action) => action switch
    {
        Navigate a => state with { Selection = state.Selection with { ScreenId = a.ScreenId, VariantId = a.ScreenId == state.Selection.ScreenId ? state.Selection.VariantId : null }, Overlays = Array.AsReadOnly(Array.Empty<Guid>()) },
        ShowVariant a => state with { Selection = state.Selection with { VariantId = a.VariantId } },
        SetDemoValue a => state with { Values = SetValue(state.Values, a.NodeId, a.Value) },
        SelectDataset a => state with { Selection = state.Selection with { DatasetId = a.DatasetId } },
        OpenOverlay a => state with { Overlays = Array.AsReadOnly(state.Overlays.Append(a.ScreenId).ToArray()) },
        CloseOverlay => state with { Overlays = Array.AsReadOnly(state.Overlays.SkipLast(1).ToArray()) },
        ResetPreview => initial,
        _ => throw new InvalidOperationException("Unsupported action.")
    };
    private void ValidateAction(Snapshot state, PreviewAction action)
    {
        if (action is ShowVariant { VariantId: Guid id } && !definition.Variants.Any(v => v.Id == id && v.ScreenId == state.Selection.ScreenId))
            throw new InvalidOperationException("Variant must belong to the navigation screen at this action.");
        if (action is SetDemoValue value)
        {
            var active = state.Overlays.Count > 0 ? state.Overlays[^1] : state.Selection.ScreenId;
            if (!definition.Screens.Single(s => s.Id == active).NodeIds.Contains(value.NodeId))
                throw new InvalidOperationException("Demo value target must belong to the active screen at this action.");
            if (value.Value?.Length > 4096) throw new InvalidOperationException("Demo values are limited to 4096 characters.");
        }
    }
    private static IReadOnlyDictionary<Guid, string?> EmptyValues() => new System.Collections.ObjectModel.ReadOnlyDictionary<Guid, string?>(new Dictionary<Guid, string?>());
    private static IReadOnlyDictionary<Guid, string?> SetValue(IReadOnlyDictionary<Guid, string?> source, Guid id, string? value)
    {
        var values = new Dictionary<Guid, string?>(source) { [id] = value };
        return new System.Collections.ObjectModel.ReadOnlyDictionary<Guid, string?>(values);
    }
}
