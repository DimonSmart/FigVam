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
        // Map only actual generated bundle chunks, never an arbitrary user-supplied filesystem path.
        foreach (var file in FrontendAssets.Chunks())
        {
            var name = Path.GetFileName(file);
            MapFile("/" + name, name, "text/javascript; charset=utf-8");
        }

        MapFile("/editor.css", "editor.css", "text/css; charset=utf-8");
        MapFile("/editor-shell.css", "editor-shell.css", "text/css; charset=utf-8");
        MapFile("/home.css", "home.css", "text/css; charset=utf-8");
    }
}
