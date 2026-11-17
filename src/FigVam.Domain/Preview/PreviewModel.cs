namespace FigVam.Domain.Preview;

public enum PreviewEvent { Click, Change, Hover, Leave }
public sealed record PreviewScreen(Guid Id, IReadOnlyList<Guid> NodeIds);
public sealed record PreviewScenario(Guid Id, Guid ScreenId, Guid NodeId, PreviewEvent Event, IReadOnlyList<PreviewAction> Actions);
public abstract record PreviewAction;
public sealed record Navigate(Guid ScreenId) : PreviewAction;
public sealed record ShowVariant(Guid? VariantId) : PreviewAction;
public sealed record SetDemoValue(Guid NodeId, string? Value) : PreviewAction;
public sealed record SelectDataset(Guid? DatasetId) : PreviewAction;
public sealed record OpenOverlay(Guid ScreenId) : PreviewAction;
public sealed record CloseOverlay : PreviewAction;
public sealed record ResetPreview : PreviewAction;
public sealed record PreviewViewport(double Width, double Height);
public sealed record PreviewSelection(Guid ScreenId, Guid? VariantId, Guid? DatasetId, Guid? ThemeId, PreviewViewport Viewport);
public sealed record PreviewDefinition(IReadOnlyList<PreviewScreen> Screens, IReadOnlyList<Guid> VariantIds,
    IReadOnlyList<Guid> DatasetIds, IReadOnlyList<Guid> ThemeIds, IReadOnlyList<PreviewScenario> Scenarios, PreviewSelection InitialSelection);
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
        foreach (var id in definition.VariantIds) Register(id, "variant");
        foreach (var id in definition.DatasetIds) Register(id, "dataset");
        foreach (var id in definition.ThemeIds) Register(id, "theme");
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
        if (selection.ThemeId is Guid t) Reference(Guid.Empty, t, "theme");
        if (selection.Viewport is null || !double.IsFinite(selection.Viewport.Width) || !double.IsFinite(selection.Viewport.Height) || selection.Viewport.Width <= 0 || selection.Viewport.Height <= 0)
            errors.Add(new("invalid-viewport", Guid.Empty, null, "Viewport dimensions must be finite and positive."));
        foreach (var scenario in definition.Scenarios)
        {
            Reference(scenario.Id, scenario.ScreenId, "screen"); Reference(scenario.Id, scenario.NodeId, "node");
            if (definition.Screens.FirstOrDefault(s => s.Id == scenario.ScreenId) is { } screen && !screen.NodeIds.Contains(scenario.NodeId))
                errors.Add(new("node-screen-mismatch", scenario.Id, scenario.NodeId, "Event node must belong to its screen."));
            if (!Enum.IsDefined(scenario.Event)) errors.Add(new("invalid-event", scenario.Id, null, "Event is not supported."));
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
            VariantIds = Array.AsReadOnly(definition.VariantIds.ToArray()), DatasetIds = Array.AsReadOnly(definition.DatasetIds.ToArray()),
            ThemeIds = Array.AsReadOnly(definition.ThemeIds.ToArray()),
            Scenarios = Array.AsReadOnly(definition.Scenarios.Select(s => s with { Actions = Array.AsReadOnly(s.Actions.ToArray()) }).ToArray())
        };
        var start = new Snapshot(copy.InitialSelection, EmptyValues(), Array.AsReadOnly(Array.Empty<Guid>()));
        return new(copy, start, start, []);
    }
    public PreviewSession Select(PreviewSelection selection)
    {
        var errors = PreviewValidator.Validate(definition with { InitialSelection = selection });
        if (errors.Count > 0) throw new InvalidOperationException(string.Join("; ", errors.Select(e => $"{e.Code}: {e.Message}")));
        return Commit(current with { Selection = selection });
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
        foreach (var action in scenarios.SelectMany(s => s.Actions)) next = Apply(next, action);
        return Commit(next);
    }
    public PreviewSession Back() => history.Count == 0 ? this : new(definition, initial, history[^1], history.Take(history.Count - 1).ToArray());
    public PreviewSession Reset() => new(definition, initial, initial, []);
    public PreviewSession RestartFlow() => Reset();
    private PreviewSession Commit(Snapshot next) => new(definition, initial, next, [.. history, current]);
    private Snapshot Apply(Snapshot state, PreviewAction action) => action switch
    {
        Navigate a => state with { Selection = state.Selection with { ScreenId = a.ScreenId }, Overlays = Array.AsReadOnly(Array.Empty<Guid>()) },
        ShowVariant a => state with { Selection = state.Selection with { VariantId = a.VariantId } },
        SetDemoValue a => state with { Values = SetValue(state.Values, a.NodeId, a.Value) },
        SelectDataset a => state with { Selection = state.Selection with { DatasetId = a.DatasetId } },
        OpenOverlay a => state with { Overlays = Array.AsReadOnly(state.Overlays.Append(a.ScreenId).ToArray()) },
        CloseOverlay => state with { Overlays = Array.AsReadOnly(state.Overlays.SkipLast(1).ToArray()) },
        ResetPreview => initial,
        _ => throw new InvalidOperationException("Unsupported action.")
    };
    private static IReadOnlyDictionary<Guid, string?> EmptyValues() => new System.Collections.ObjectModel.ReadOnlyDictionary<Guid, string?>(new Dictionary<Guid, string?>());
    private static IReadOnlyDictionary<Guid, string?> SetValue(IReadOnlyDictionary<Guid, string?> source, Guid id, string? value)
    {
        var values = new Dictionary<Guid, string?>(source) { [id] = value };
        return new System.Collections.ObjectModel.ReadOnlyDictionary<Guid, string?>(values);
    }
}
