using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Layout;
using FigVam.Domain.Preview;

namespace FigVam.Server.Mcp;

// A server-owned browser renders only a revision-pinned local snapshot. It receives
// no user credentials, tunnel grants, URLs or access to the live editor.
public sealed class HeadlessPreviewCapture(IConfiguration configuration,
    IDocumentStructureQueries queries, IDocumentTokenQueries tokens, IDocumentAssets assets)
{
    private readonly SemaphoreSlim slots = new(1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, long revision, PreviewSession session,
        IReadOnlyDictionary<Guid, string?> values, CancellationToken ct)
    {
        var executable = configuration["Mcp:ChromiumExecutable"];
        if (string.IsNullOrWhiteSpace(executable) || !Path.IsPathFullyQualified(executable) || !File.Exists(executable))
            return new("RENDER_UNAVAILABLE");
        // An overlay stack requires compositing multiple surfaces; do not silently
        // return a screenshot of a different state.
        if (session.Overlays.Count != 0) return new("PREVIEW_OVERLAY_RENDER_UNSUPPORTED");
        var screen = session.Selection.ScreenId;
        var actor = new DocumentActor(grant.UserId);
        var info = await queries.QueryAsync(grant.DocumentId, new("screen", screen, Fields: "dimensions", Revision: revision), actor, ct);
        if (info.Response is null) return new(info.Code);
        var dimensions = info.Response.Items.Single().Dimensions!;
        if (dimensions.Width < 1 || dimensions.Height < 1 || dimensions.Width > 4096 || dimensions.Height > 4096 ||
            Math.Ceiling(dimensions.Width) * Math.Ceiling(dimensions.Height) > 4 * 1024 * 1024)
            return new("IMAGE_TOO_LARGE");
        var width = (int)Math.Ceiling(dimensions.Width);
        var height = (int)Math.Ceiling(dimensions.Height);
        var theme = session.Selection.Theme;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        var token = timeout.Token;
        var acquired = false;
        string? directory = null;
        Process? process = null;
        try
        {
            await slots.WaitAsync(token);
            acquired = true;
            var profile = await queries.ReadProfileAsync(grant.DocumentId, revision, actor, token);
            var manifest = await assets.ListAsync(grant.DocumentId, actor, revision, cancellationToken: token);
            if (profile.Response is null || manifest.Response is null)
                return new("CAPTURE_FAILED");
            var nodes = new List<StructureItem>();
            var boxes = new List<LayoutBox>();
            var overrides = new List<ScreenLayoutOverride>();
            var tokenItems = new List<FigVam.Domain.Tokens.DesignToken>();
            int total;
            do
            {
                var page = await queries.QueryAsync(grant.DocumentId, new("nodes", Offset: nodes.Count, Limit: 100,
                    Fields: "kind,properties,name,parentId,childCount,canContainChildren", ScreenId: screen, Revision: revision), actor, token);
                if (page.Response is not { } response) return new(page.Code);
                nodes.AddRange(response.Items);
                total = response.Total;
            } while (nodes.Count < total);
            do
            {
                var page = await queries.ReadScreenLayoutAsync(grant.DocumentId, new(screen, revision, boxes.Count, 100,
                    dimensions, session.Selection.VariantId, session.Selection.DatasetId, theme), actor, token);
                if (page.Response is not { } response) return new(page.Code);
                boxes.AddRange(response.Boxes);
                overrides.AddRange(response.Overrides ?? []);
                total = response.Total;
            } while (boxes.Count < total);
            do
            {
                var page = await tokens.ListAsync(grant.DocumentId, revision, tokenItems.Count, 100, actor, token);
                if (page.Response is not { } response) return new(page.Code);
                tokenItems.AddRange(response.Items);
                total = response.Total;
            } while (tokenItems.Count < total);

            var referenced = nodes.SelectMany(n => n.Properties?.Values ?? Enumerable.Empty<NodePropertyValue>())
                .Concat(overrides.SelectMany(o => o.Properties.Values)).OfType<NodeAssetValue>().Select(v => v.AssetId).Distinct();
            var assetData = new Dictionary<Guid, string>();
            foreach (var id in referenced)
            {
                var asset = await assets.ReadAsync(grant.DocumentId, id, actor, revision, cancellationToken: token);
                if (asset.Content is null) return new(asset.Code);
                assetData[id] = Convert.ToBase64String(asset.Content.Content);
            }
            directory = Path.Combine(Path.GetTempPath(), "figvam-preview-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            foreach (var file in new[] { "screen-capture.js", "render-model.js", "decode.js", "screen-renderer.js", "token-resolution.js", "editor.css", "editor-shell.css", "home.css" })
                File.Copy(Path.Combine(AppContext.BaseDirectory, "wwwroot", file), Path.Combine(directory, file));
            var snapshot = JsonSerializer.Serialize(new { screen, theme = theme.ToString(), width, height, nodes, boxes,
                overrides, kinds = profile.Response.Kinds, tokens = tokenItems, assets = manifest.Response.Assets, assetData, values }, Json);
            // The default JSON encoder escapes HTML-sensitive characters, so document text
            // cannot escape the inert JSON element or inject a script into Chromium.
            var html = """
                <!doctype html><html><head><meta charset="utf-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'">
                <link rel="stylesheet" href="editor.css"><link rel="stylesheet" href="editor-shell.css"><link rel="stylesheet" href="home.css">
                </head><body><script id="snapshot" type="application/json">
                """ + snapshot + """
                </script><pre id="result"></pre><script type="module" src="headless-preview.js"></script></body></html>
                """;
            await File.WriteAllTextAsync(Path.Combine(directory, "index.html"), html, token);
            File.Copy(Path.Combine(AppContext.BaseDirectory, "wwwroot", "headless-preview.js"), Path.Combine(directory, "headless-preview.js"));
            var start = new ProcessStartInfo(executable)
            {
                UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true
            };
            foreach (var argument in new[] { "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
                "--disable-sync", "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
                "--virtual-time-budget=15000", "--dump-dom", "--user-data-dir=" + Path.Combine(directory, "profile"),
                new Uri(Path.Combine(directory, "index.html")).AbsoluteUri })
                start.ArgumentList.Add(argument);
            process = Process.Start(start);
            if (process is null) return new("RENDER_UNAVAILABLE");
            var output = process.StandardOutput.ReadToEndAsync(token);
            var errors = process.StandardError.ReadToEndAsync(token);
            await process.WaitForExitAsync(token);
            var dom = await output;
            _ = await errors; // Never log browser output or document content.
            if (process.ExitCode != 0) return new("CAPTURE_FAILED");
            var match = Regex.Match(dom, "<pre id=\"result\">PNG:([A-Za-z0-9+/=]+)</pre>", RegexOptions.CultureInvariant);
            if (!match.Success || match.Groups[1].Length > (ScreenCaptureResult.MaxPngBytes + 2L) / 3 * 4)
                return new("CAPTURE_FAILED");
            var result = ScreenCaptureResult.FromPng(Convert.FromBase64String(match.Groups[1].Value)) with { Theme = theme.ToString() };
            return result.Width == width && result.Height == height ? result : new("CAPTURE_FAILED");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new(grant.CaptureRevoked.IsCancellationRequested ? "ACCESS_DENIED" : "CAPTURE_TIMEOUT");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or Win32Exception or InvalidOperationException or FormatException)
        {
            return new("CAPTURE_FAILED");
        }
        finally
        {
            if (process is not null)
            {
                try { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); } }
                catch (InvalidOperationException) { }
                catch (Win32Exception) { }
                process.Dispose();
            }
            if (directory is not null)
                try { Directory.Delete(directory, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            if (acquired) slots.Release();
        }
    }
}
