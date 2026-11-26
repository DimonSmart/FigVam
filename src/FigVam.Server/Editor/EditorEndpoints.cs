namespace FigVam.Server.Editor;

public static class EditorEndpoints
{
    public static void MapEditor(this WebApplication app)
    {
        void MapFile(string route, string name, string contentType)
        {
            app.MapGet(route, (HttpContext context) =>
            {
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Headers.XContentTypeOptions = "nosniff";
                context.Response.Headers["Referrer-Policy"] = "no-referrer";
                context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob: data:; media-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
                return Results.File(Path.Combine(AppContext.BaseDirectory, "wwwroot", name), contentType);
            }).AllowAnonymous().DisableRateLimiting().ExcludeFromDescription();
        }

        MapFile("/", "index.html", "text/html; charset=utf-8");
        MapFile("/documents/{documentId:guid}", "index.html", "text/html; charset=utf-8");
        MapFile("/editor.js", "editor.js", "text/javascript; charset=utf-8");
        MapFile("/home-ui.js", "home-ui.js", "text/javascript; charset=utf-8");

        MapFile("/screen-capture.js", "screen-capture.js", "text/javascript; charset=utf-8");
        MapFile("/editor-shell.js", "editor-shell.js", "text/javascript; charset=utf-8");
        MapFile("/auth-client.js", "auth-client.js", "text/javascript; charset=utf-8");

        MapFile("/api-client.js", "api-client.js", "text/javascript; charset=utf-8");
        MapFile("/canvas-viewport.js", "canvas-viewport.js", "text/javascript; charset=utf-8");
        MapFile("/canvas-node-editor.js", "canvas-node-editor.js", "text/javascript; charset=utf-8");
        MapFile("/visual-screen.js", "visual-screen.js", "text/javascript; charset=utf-8");
        MapFile("/visual-node-editor.js", "visual-node-editor.js", "text/javascript; charset=utf-8");
        MapFile("/node-property-controls.js", "node-property-controls.js", "text/javascript; charset=utf-8");
        MapFile("/padding-editor.js", "padding-editor.js", "text/javascript; charset=utf-8");
        MapFile("/token-value-control.js", "token-value-control.js", "text/javascript; charset=utf-8");
        MapFile("/token-resolution.js", "token-resolution.js", "text/javascript; charset=utf-8");
        MapFile("/screen-renderer.js", "screen-renderer.js", "text/javascript; charset=utf-8");

        MapFile("/datasets.js", "datasets.js", "text/javascript; charset=utf-8");
        MapFile("/members.js", "members.js", "text/javascript; charset=utf-8");
        MapFile("/presence.js", "presence.js", "text/javascript; charset=utf-8");
        MapFile("/document-collaboration.js", "document-collaboration.js", "text/javascript; charset=utf-8");
        MapFile("/document-export.js", "document-export.js", "text/javascript; charset=utf-8");
        MapFile("/document-history.js", "document-history.js", "text/javascript; charset=utf-8");
        MapFile("/layers.js", "layers.js", "text/javascript; charset=utf-8");
        MapFile("/layer-caption.js", "layer-caption.js", "text/javascript; charset=utf-8");
        MapFile("/layer-drag.js", "layer-drag.js", "text/javascript; charset=utf-8");
        MapFile("/scenarios.js", "scenarios.js", "text/javascript; charset=utf-8");
        MapFile("/interaction-catalog.js", "interaction-catalog.js", "text/javascript; charset=utf-8");
        MapFile("/interaction-editor.js", "interaction-editor.js", "text/javascript; charset=utf-8");
        MapFile("/screen-resize.js", "screen-resize.js", "text/javascript; charset=utf-8");
        MapFile("/screen-variants.js", "screen-variants.js", "text/javascript; charset=utf-8");

        MapFile("/tokens.js", "tokens.js", "text/javascript; charset=utf-8");
        MapFile("/token-groups.js", "token-groups.js", "text/javascript; charset=utf-8");
        MapFile("/token-exchange.js", "token-exchange.js", "text/javascript; charset=utf-8");
        MapFile("/styles.js", "styles.js", "text/javascript; charset=utf-8");
        MapFile("/session.js", "session.js", "text/javascript; charset=utf-8");
        MapFile("/editor.css", "editor.css", "text/css; charset=utf-8");
        MapFile("/editor-shell.css", "editor-shell.css", "text/css; charset=utf-8");
        MapFile("/home.css", "home.css", "text/css; charset=utf-8");
    }
}
