using System.ComponentModel;
using System.Text.Json;
using FigVam.Application.Documents;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

[McpServerToolType]
public sealed class McpRenderTools(IHttpContextAccessor accessor, IDocumentStructureQueries queries,
    IScreenCaptureService capture)
{
    [McpServerTool(Name = "render_screen", ReadOnly = true),
     Description("Capture the actual browser-rendered image of the screen currently displayed in FigVam Preview. Requires the user to enable Screen Capture in MCP Access. Returns PNG and actual dimensions. Does not modify the document.")]
    public async Task<CallToolResult> RenderScreen(Guid screenId, long? revision = null, CancellationToken ct = default)
    {
        var http = accessor.HttpContext!;
        var grant = (McpDocumentGrant)http.Items[McpServiceRegistration.GrantKey]!;
        var actor = new DocumentActor(grant.UserId);
        var screen = await queries.QueryAsync(grant.DocumentId, new("screen", screenId, Fields: "name"), actor, ct);
        if (screen.Response is null)
            return Error(screen.Code == "FORBIDDEN" ? "CAPTURE_CANCELLED" : "SCREEN_NOT_FOUND");
        var target = revision ?? screen.Response.Revision;
        if (target != screen.Response.Revision) return Error("RENDER_REVISION_MISMATCH");
        var result = await capture.CaptureAsync(grant, screenId, target, ct);
        if (grant.CaptureRevoked.IsCancellationRequested ||
            !await McpServiceRegistration.CanEditAsync(http.RequestServices, grant.DocumentId, grant.UserId, ct) ||
            grant.CaptureRevoked.IsCancellationRequested)
            return Error("CAPTURE_CANCELLED");
        if (result.Png is null) return Error(result.Code);
        var metadata = JsonSerializer.SerializeToElement(new { screenId, revision = target, width = result.Width, height = result.Height });
        return new CallToolResult
        {
            Content = [ImageContentBlock.FromBytes(result.Png, "image/png"), new TextContentBlock { Text = metadata.GetRawText() }],
            StructuredContent = metadata
        };
    }

    private static CallToolResult Error(string code)
    {
        var message = code switch
        {
            "RENDERER_UNAVAILABLE" => "Open the document in a supported browser and enable Screen Capture in Preview.",
            "SCREEN_NOT_DISPLAYED" => "The requested screen is not currently displayed in the connected browser.",
            "SCREEN_NOT_FOUND" => "The screen does not exist in this document.",
            "RENDER_REVISION_MISMATCH" => "The requested revision is not the rendered current revision. Read the current document and retry.",
            "CAPTURE_TIMEOUT" => "The browser did not return a fresh frame in time. Keep Preview visible and retry.",
            "CAPTURE_CANCELLED" => "Screen capture was stopped, disconnected or access was revoked.",
            "IMAGE_TOO_LARGE" => "The PNG exceeds the configured image limit.",
            _ => "Screen capture failed. Check Preview and retry."
        };
        var data = JsonSerializer.SerializeToElement(new { status = "REJECTED", code, message });
        return new CallToolResult { IsError = true, StructuredContent = data, Content = [new TextContentBlock { Text = data.GetRawText() }] };
    }
}
