using FigVam.Domain.Tokens;
using FigVam.Domain.Preview;

namespace FigVam.Server.Tests;

public class PreviewTests
{
    private static PreviewDefinition Definition()
    {
        var screen = Guid.NewGuid(); var node = Guid.NewGuid(); var next = Guid.NewGuid(); var nextNode = Guid.NewGuid();
        var variant = Guid.NewGuid(); var dataset = Guid.NewGuid();
        return new([new(screen, [node]), new(next, [nextNode])], [new(variant, screen)], [dataset],
        [
            new(Guid.NewGuid(), screen, node, PreviewEvent.Click, [new SetDemoValue(node, "demo"), new SelectDataset(dataset), new OpenOverlay(next)]),
            new(Guid.NewGuid(), next, nextNode, PreviewEvent.Leave, [new CloseOverlay()]),
            new(Guid.NewGuid(), screen, node, PreviewEvent.Hover, [new ShowVariant(variant), new Navigate(next)]),
            new(Guid.NewGuid(), next, nextNode, PreviewEvent.Change, [new ResetPreview()])
        ], new(screen, null, null, TokenTheme.Light, new(800, 600)));
    }

    [Fact]
    public void EventsApplyActionsAtomicallyAndBackRestoresCompleteState()
    {
        var d = Definition(); var start = PreviewSession.Start(d); var node = d.Screens[0].NodeIds[0];
        var clicked = start.Trigger(node, PreviewEvent.Click);
        Assert.Equal(d.DatasetIds[0], clicked.Selection.DatasetId);
        Assert.Null(clicked.Selection.VariantId);
        Assert.Equal("demo", clicked.Values[node]);
        Assert.Equal(d.Screens[1].Id, Assert.Single(clicked.Overlays));
        Assert.Empty(start.Values);
        var closed = clicked.Trigger(d.Screens[1].NodeIds[0], PreviewEvent.Leave);
        Assert.Empty(closed.Overlays);
        Assert.Single(closed.Back().Overlays);
        var back = closed.Back().Back();
        Assert.Equal(d.InitialSelection, back.Selection);
        Assert.Empty(back.Values); Assert.False(back.CanGoBack);
    }

    [Fact]
    public void SelectionAxesAreIndependentAndFlowCanBeReplayedAndReset()
    {
        var d = Definition(); var node = d.Screens[0].NodeIds[0];
        var start = PreviewSession.Start(d);
        var datasetOnly = start.Select(start.Selection with { DatasetId = d.DatasetIds[0] });
        Assert.Equal(start.Selection.ScreenId, datasetOnly.Selection.ScreenId);
        Assert.Equal(start.Selection.VariantId, datasetOnly.Selection.VariantId);
        var first = datasetOnly.Trigger(node, PreviewEvent.Hover);
        var second = PreviewSession.Start(d).Select(d.InitialSelection with { DatasetId = d.DatasetIds[0] }).Trigger(node, PreviewEvent.Hover);
        Assert.Equal(first.Selection, second.Selection);
        Assert.Null(first.Selection.VariantId);
        Assert.Equal(d.DatasetIds[0], first.Selection.DatasetId);
        Assert.Equal(d.InitialSelection, first.RestartFlow().Selection);
        Assert.False(first.RestartFlow().CanGoBack);
        var resetAction = first.Trigger(d.Screens[1].NodeIds[0], PreviewEvent.Change);
        Assert.Equal(d.InitialSelection, resetAction.Selection);
        Assert.Equal(first.Selection, resetAction.Back().Selection);
        Assert.Equal(d.InitialSelection, first.Reset().Selection);
    }

    [Fact]
    public void DiagnosticsRejectInvalidReferencesAndViewportBeforeExecution()
    {
        var d = Definition(); var missing = Guid.NewGuid(); var scenario = d.Scenarios[0];
        d = d with { InitialSelection = d.InitialSelection with { Viewport = new(double.NaN, 0) },
            Scenarios = [scenario with { NodeId = d.Screens[1].NodeIds[0], Actions = [new Navigate(missing), new SelectDataset(d.Screens[0].Id)] }] };
        var errors = PreviewValidator.Validate(d);
        Assert.Contains(errors, e => e.Code == "missing-reference" && e.ReferenceId == missing);
        Assert.Contains(errors, e => e.Code == "wrong-reference-type" && e.ReferenceId == d.Screens[0].Id);
        Assert.Contains(errors, e => e.Code == "node-screen-mismatch");
        Assert.Contains(errors, e => e.Code == "invalid-viewport");
        Assert.Throws<InvalidOperationException>(() => PreviewSession.Start(d));
    }
}
