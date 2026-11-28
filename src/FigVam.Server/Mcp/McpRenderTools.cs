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
     Description("Render any screen of the authorized document at its design dimensions in Light or Dark theme, without opening Preview. If theme is omitted, use Light. Returns PNG and revision metadata. Does not modify the document.")]
    public async Task<CallToolResult> RenderScreen(Guid screenId, long? revision = null, string? theme = null, CancellationToken ct = default)
    {
        if (theme is not null && theme is not ("Light" or "Dark")) return Error("INVALID_THEME");
        var http = accessor.HttpContext!;
        var grant = (McpDocumentGrant)http.Items[McpServiceRegistration.GrantKey]!;
        var actor = new DocumentActor(grant.UserId);
        var screen = await queries.QueryAsync(grant.DocumentId, new("screen", screenId, Fields: "name,dimensions"), actor, ct);
        if (screen.Response is null)
            return Error(screen.Code == "FORBIDDEN" ? "ACCESS_DENIED" : "SCREEN_NOT_FOUND");
        var target = revision ?? screen.Response.Revision;
        if (target != screen.Response.Revision) return Error("RENDER_REVISION_MISMATCH");
        var dimensions = screen.Response.Items.Single().Dimensions!;
        if (dimensions.Width < 1 || dimensions.Height < 1 || dimensions.Width > 4096 || dimensions.Height > 4096 ||
            Math.Ceiling(dimensions.Width) * Math.Ceiling(dimensions.Height) > 4 * 1024 * 1024)
            return Error("IMAGE_TOO_LARGE");
        var width = (int)Math.Ceiling(dimensions.Width);
        var height = (int)Math.Ceiling(dimensions.Height);
        var result = await capture.CaptureAsync(grant, screenId, target, ct, theme, width, height);
        if (grant.CaptureRevoked.IsCancellationRequested ||
            !await McpServiceRegistration.CanEditAsync(http.RequestServices, grant.DocumentId, grant.UserId, ct) ||
            grant.CaptureRevoked.IsCancellationRequested)
            return Error("ACCESS_DENIED");
        if (result.Png is null) return Error(result.Code switch
        {
            "RENDERER_UNAVAILABLE" => "RENDER_UNAVAILABLE",
            "CAPTURE_TIMEOUT" => "RENDER_TIMEOUT",
            "CAPTURE_CANCELLED" => "RENDER_UNAVAILABLE",
            "CAPTURE_FAILED" => "RENDER_FAILED",
            _ => result.Code
        });
        if (result.Width != width || result.Height != height || result.Theme is not ("Light" or "Dark") ||
            (theme is not null && result.Theme != theme)) return Error("RENDER_FAILED");
        var metadata = JsonSerializer.SerializeToElement(new { screenId, revision = target, theme = result.Theme, width = result.Width, height = result.Height });
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
            "RENDER_UNAVAILABLE" => "The server Chromium renderer is unavailable. Install the matching Playwright Chromium and system dependencies.",
            "INVALID_THEME" => "Theme must be Light or Dark.",
            "ACCESS_DENIED" => "Document access was revoked or is no longer authorized.",
            "SCREEN_NOT_FOUND" => "The screen does not exist in this document.",
            "RENDER_REVISION_MISMATCH" => "The requested revision is not the rendered current revision. Read the current document and retry.",
            "RENDER_TIMEOUT" => "The renderer did not return a fresh image in time.",
            "IMAGE_TOO_LARGE" => "The PNG exceeds the configured image limit.",
            _ => "Screen capture failed. Retry the render request."
        };
        var data = JsonSerializer.SerializeToElement(new { status = "REJECTED", code, message });
        return new CallToolResult { IsError = true, StructuredContent = data, Content = [new TextContentBlock { Text = data.GetRawText() }] };
    }
}
