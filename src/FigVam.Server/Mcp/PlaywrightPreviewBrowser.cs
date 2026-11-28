using Microsoft.Playwright;

namespace FigVam.Server.Mcp;

internal sealed class PreviewBrowserUnavailableException : Exception { }

// No HTTP server, file URLs, live document endpoints or credentials are exposed to
// Chromium. Every permitted request is fulfilled from server-owned bytes in memory.
public sealed class PlaywrightPreviewBrowser : IAsyncDisposable
{
    private const string Origin = "https://figvam-render.invalid/";
    private readonly SemaphoreSlim lifecycle = new(1);
    private IPlaywright? playwright;
    private IBrowser? browser;

    private async Task<IBrowser> GetBrowserAsync(CancellationToken ct)
    {
        await lifecycle.WaitAsync(ct);
        try
        {
            if (browser is { IsConnected: true }) return browser;
            if (browser is not null)
            {
                try { await browser.CloseAsync(); } catch (PlaywrightException) { }
                browser = null;
            }
            try
            {
                playwright ??= await Playwright.CreateAsync();
                browser = await playwright.Chromium.LaunchAsync(new()
                {
                    Headless = true,
                    Timeout = 15000,
                    ChromiumSandbox = true
                });
                return browser;
            }
            catch (Exception error) when (error is PlaywrightException or IOException or InvalidOperationException)
            {
                playwright?.Dispose();
                playwright = null;
                throw new PreviewBrowserUnavailableException();
            }
        }
        finally { lifecycle.Release(); }
    }

    public async Task<byte[]> ScreenshotAsync(string snapshot, int width, int height, bool dark, CancellationToken ct)
    {
        var instance = await GetBrowserAsync(ct);
        ct.ThrowIfCancellationRequested();
        await using var context = await instance.NewContextAsync(new()
        {
            ViewportSize = new() { Width = width, Height = height },
            DeviceScaleFactor = 1,
            ColorScheme = dark ? ColorScheme.Dark : ColorScheme.Light,
            ReducedMotion = ReducedMotion.Reduce,
            ServiceWorkers = ServiceWorkerPolicy.Block,
            AcceptDownloads = false
        });
        context.SetDefaultTimeout(30000);
        var files = new Dictionary<string, (string Path, string ContentType)>(StringComparer.Ordinal);
        var root = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        foreach (var name in new[] { "editor.css", "editor-shell.css", "home.css", "headless-preview.js" })
            files.Add(Origin + name, (Path.Combine(root, name), name.EndsWith(".css") ? "text/css" : "text/javascript"));
        foreach (var chunk in FigVam.Server.Editor.FrontendAssets.Chunks())
            files.Add(Origin + Path.GetFileName(chunk), (chunk, "text/javascript"));
        var html = """
            <!doctype html><html><head><meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
            <link rel="stylesheet" href="editor.css"><link rel="stylesheet" href="editor-shell.css"><link rel="stylesheet" href="home.css">
            </head><body><main id="render-root"></main><script id="snapshot" type="application/json">
            """ + snapshot + """
            </script><script type="module" src="headless-preview.js"></script></body></html>
            """;
        await context.RouteAsync("**/*", async route =>
        {
            if (route.Request.Method == "GET" && route.Request.Url == Origin + "render.html")
                await route.FulfillAsync(new() { ContentType = "text/html; charset=utf-8", Body = html });
            else if (route.Request.Method == "GET" && files.TryGetValue(route.Request.Url, out var file))
                await route.FulfillAsync(new() { ContentType = file.ContentType, Path = file.Path });
            else await route.AbortAsync();
        }).WaitAsync(ct);
        var page = await context.NewPageAsync().WaitAsync(ct);
        await page.GotoAsync(Origin + "render.html").WaitAsync(ct);
        await page.WaitForFunctionAsync("() => document.documentElement.dataset.renderStatus === 'ready' || document.documentElement.dataset.renderStatus === 'failed'").WaitAsync(ct);
        if (await page.Locator("html").GetAttributeAsync("data-render-status").WaitAsync(ct) != "ready")
            throw new InvalidOperationException("Render page preparation failed.");
        return await page.ScreenshotAsync(new()
        {
            Type = ScreenshotType.Png, Scale = ScreenshotScale.Css,
            Animations = ScreenshotAnimations.Disabled, Caret = ScreenshotCaret.Hide
        }).WaitAsync(ct);
    }

    public async ValueTask DisposeAsync()
    {
        await lifecycle.WaitAsync();
        try
        {
            if (browser is not null)
                try { await browser.CloseAsync(); } catch (PlaywrightException) { }
            playwright?.Dispose();
        }
        finally { lifecycle.Release(); lifecycle.Dispose(); }
    }
}
