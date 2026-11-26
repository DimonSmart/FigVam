using System.ComponentModel;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

public sealed record McpPreviewEvent(Guid NodeId, string Event, string? Value = null);

[McpServerToolType]
public sealed class McpPreviewTools(IHttpContextAccessor accessor, IDocumentStructureQueries queries,
    IDocumentPreviewFactory previews, IDocumentStateReader reader, INodeProfile profile, HeadlessPreviewCapture capture)
{
    [McpServerTool(Name = "simulate_preview", ReadOnly = true),
     Description("Replay up to 128 Click, Change or Submit events on an isolated Preview at the specified revision and theme. Change can supply a demonstration value. Events must target nodes on the active screen. Returns execution trace, state and diagnostics without changing the document or the user's editor. Set includeImage to render the final screen using a server-owned Chromium renderer. Password values are not returned.")]
    public async Task<CallToolResult> SimulatePreview(Guid screenId, IReadOnlyList<McpPreviewEvent> events,
        string theme = "Light", bool includeImage = false, long? revision = null, CancellationToken ct = default)
    {
        if (theme is not ("Light" or "Dark")) return McpReadTools.Result("INVALID_THEME", null);
        if (events is null || events.Count > 128 ||
            events.Any(e => e is null || e.NodeId == Guid.Empty || e.Event is not ("Click" or "Change" or "Submit") || e.Value?.Length > 4096))
            return McpReadTools.Result("INVALID_PREVIEW_REQUEST", null);

        var grant = (McpDocumentGrant)accessor.HttpContext!.Items[McpServiceRegistration.GrantKey]!;
        var actor = new DocumentActor(grant.UserId);
        var screen = await queries.QueryAsync(grant.DocumentId, new("screen", screenId, Fields: "dimensions", Revision: revision), actor, ct);
        if (screen.Response is null) return McpReadTools.Result(screen.Code, null);
        var dimensions = screen.Response.Items.Single().Dimensions!;
        var pinned = screen.Response.Revision;
        var created = await previews.CreateAsync(grant.DocumentId, pinned,
            new(screenId, null, null, Enum.Parse<TokenTheme>(theme), new(dimensions.Width, dimensions.Height)), actor, ct);
        if (created.Preview is not { } preview)
            return McpReadTools.Result(created.Code, null);
        var read = await reader.ReadAsync(grant.DocumentId, pinned, ct);
        if (read.State is not { } state) return McpReadTools.Result(read.Code, null);
        var selected = PortableUiProfileResolver.Require(state.Document.Profile, profile);
        var resolver = new DesignStyleResolver(state.Document, selected);
        var nodes = state.Document.Nodes.ToDictionary(n => n.Id);
        var session = preview.Session;
        var steps = new List<object>();
        var diagnostics = new List<object>();
        bool failed = false;

        foreach (var interaction in events)
        {
            ct.ThrowIfCancellationRequested();
            var @event = Enum.Parse<PreviewEvent>(interaction.Event);
            var before = session.Selection.ScreenId;
            try
            {
                if (!nodes.TryGetValue(interaction.NodeId, out var node) || !selected.SupportsPreviewEvent(node.Kind, @event))
                    throw new InvalidOperationException("The event is not supported by this node kind.");
                var scenarios = session.MatchingScenarios(interaction.NodeId, @event);
                var next = session;
                if (interaction.Value is not null)
                {
                    if (@event != PreviewEvent.Change || !selected.SupportsDemoValue(node.Kind))
                        throw new InvalidOperationException("A value can only be supplied for Change on a demo input.");
                    next = next.WithInput(node.Id, interaction.Value);
                }
                next = next.Trigger(node.Id, @event);
                if (next.Overlays.Count > 32) throw new InvalidOperationException("Preview overlay limit exceeded.");
                session = next;
                steps.Add(new { interaction.NodeId, interaction.Event, status = "Completed", screenIdBefore = before,
                    screenIdAfter = session.Selection.ScreenId, scenarioIds = scenarios.Select(s => s.Id).ToArray(),
                    executedActions = scenarios.SelectMany(s => s.Actions).Select(ActionSummary).ToArray() });
            }
            catch (InvalidOperationException)
            {
                failed = true;
                steps.Add(new { interaction.NodeId, interaction.Event, status = "Rejected" });
                diagnostics.Add(new { code = "INVALID_PREVIEW_EVENT", interaction.NodeId, interaction.Event,
                    message = "Event is unsupported, outside the active screen, or its scenario cannot execute." });
                break;
            }
        }

        bool Password(Guid id)
        {
            if (!nodes.TryGetValue(id, out var node)) return true;
            if (node.Kind != "TextInput") return false;
            try
            {
                return resolver.EffectiveNode(node, session.Selection.Theme).GetValueOrDefault("inputType") is NodeEnumValue { Value: "Password" };
            }
            catch (DesignStyleException) { return true; }
        }

        ScreenCaptureResult? image = null;
        if (includeImage && !failed)
        {
            var values = session.Values.ToDictionary(pair => pair.Key, pair => Password(pair.Key) && pair.Value is not null
                ? new string('•', pair.Value.Length) : pair.Value);
            image = await capture.CaptureAsync(grant, pinned, session, values, ct);
            if (image.Png is null)
            {
                failed = true;
                diagnostics.Add(new { code = image.Code, message = "The independent Preview renderer could not render the final state." });
            }
        }
        if (grant.CaptureRevoked.IsCancellationRequested ||
            !await McpServiceRegistration.CanEditAsync(accessor.HttpContext!.RequestServices, grant.DocumentId, grant.UserId, ct))
            return McpReadTools.Result("ACCESS_DENIED", null);
        var response = new { status = failed ? "Rejected" : "Completed", revision = pinned,
            initialScreenId = screenId, activeScreenId = session.Selection.ScreenId, theme = session.Selection.Theme,
            session.Selection.VariantId, session.Selection.DatasetId, session.Overlays, steps, diagnostics,
            demoValues = session.Values.Where(pair => !Password(pair.Key)).ToDictionary(pair => pair.Key, pair => pair.Value) };
        var result = McpReadTools.Result("OK", response);
        if (image?.Png is { } png && !failed && result.IsError != true)
            return new CallToolResult { StructuredContent = result.StructuredContent,
                Content = [ImageContentBlock.FromBytes(png, "image/png"), .. result.Content] };
        return new CallToolResult { StructuredContent = result.StructuredContent, Content = result.Content,
            IsError = failed || result.IsError == true };
    }

    // Do not echo action values (which may contain passwords) in a trace.
    private static object ActionSummary(PreviewAction action) => action switch
    {
        Navigate a => new { type = "navigate", a.ScreenId },
        ShowVariant a => new { type = "showVariant", a.VariantId },
        SetDemoValue a => new { type = "setDemoValue", a.NodeId },
        SelectDataset a => new { type = "selectDataset", a.DatasetId },
        OpenOverlay a => new { type = "openOverlay", a.ScreenId },
        CloseOverlay => new { type = "closeOverlay" },
        ResetPreview => new { type = "resetPreview" },
        _ => new { type = "unknown" }
    };
}
