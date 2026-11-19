using System.Text.Json;
using Microsoft.Playwright;

// Separate research entry point. Uses the original locked HTML dependencies and pixel checker.
using var playwright = await Playwright.CreateAsync();
await using var browser = await playwright.Chromium.LaunchAsync(new() { Headless = true, Channel = "msedge" });
Console.WriteLine("Edge/Chromium " + browser.Version);
Console.WriteLine("OS=" + Environment.OSVersion + "; runtime=" + Environment.Version);
using var cases = JsonDocument.Parse(File.ReadAllText(args[0]));
var mappings = new (string Name, string Css)[]
{
    ("overflow-hidden", "overflow:hidden"),
    ("overflow-clip", "overflow:clip"),
    ("clip-path-inset", "overflow:visible;clip-path:inset(0)"),
    ("hidden-and-clip-path", "overflow:hidden;clip-path:inset(0)"),
    ("contain-paint", "overflow:visible;contain:paint"),
    ("hidden-composited", "overflow:hidden;transform:translateZ(0)")
};
foreach (var scale in new[] { 1f, 1.5f, 2f })
{
    await using var context = await browser.NewContextAsync(new() { ViewportSize = new() { Width = 640, Height = 480 }, DeviceScaleFactor = scale, ColorScheme = ColorScheme.Light });
    var page = await context.NewPageAsync();
    var session = await context.NewCDPSessionAsync(page);
    foreach (var mapping in mappings)
    foreach (var item in cases.RootElement.EnumerateArray())
    foreach (var mode in new[] { "visible", "clip" })
    foreach (var alpha in new[] { 255, 128 })
    {
        var width = item.GetProperty("width").GetDouble();
        var height = item.GetProperty("height").GetDouble();
        var cw = width + 4.5;
        var ch = height + 6.75;
        var sw = (int)Math.Ceiling(width) + 24;
        var sh = (int)Math.Ceiling(height) + 24;
        var css = mode == "clip" ? mapping.Css : "overflow:visible";
        await page.SetContentAsync(FormattableString.Invariant($"<!doctype html><html><body style='margin:0'><div id='stage' style='width:{sw}px;height:{sh}px;position:relative'><div id='frame' style='position:absolute;left:8px;top:8px;width:{width}px;height:{height}px;{css}'><div id='child' style='position:absolute;left:-2.25px;top:-3.375px;width:{cw}px;height:{ch}px;background:rgba(64,128,192,{alpha / 255.0});pointer-events:none'></div></div></div></body></html>"));
        var measured = await page.EvaluateAsync<double[]>("""
            () => { const f=document.querySelector('#frame').getBoundingClientRect(), c=document.querySelector('#child').getBoundingClientRect(); return [f.x,f.y,f.width,f.height,c.x-f.x,c.y-f.y,c.width,c.height]; }
            """);
        if (!measured.SequenceEqual(new[] { 8d, 8d, width, height, -2.25, -3.375, cw, ch }))
            throw new Exception("HTML nested bounds mismatch: " + mapping.Name);
        var style = await page.EvaluateAsync<string>("""
            () => { const f=document.querySelector('#frame'), c=document.querySelector('#child'), s=getComputedStyle(f); if(f.tabIndex!==-1 || c.tabIndex!==-1 || f.hasAttribute('role') || c.hasAttribute('role') || getComputedStyle(c).pointerEvents!=='none') throw Error('Unexpected authored interaction'); return JSON.stringify({overflow:s.overflow,clipPath:s.clipPath,contain:s.contain,transform:s.transform}); }
            """);
        var ax = await session.SendAsync("Accessibility.getFullAXTree");
        var roles = ax.Value.GetProperty("nodes").EnumerateArray().Where(n => !n.GetProperty("ignored").GetBoolean()).Select(n => n.GetProperty("role").GetProperty("value").GetString()).ToArray();
        if (roles.Any(r => r is "button" or "textbox" or "checkbox" or "link" or "image"))
            throw new Exception("HTML nested unexpected role: " + mapping.Name);
        Console.WriteLine($"MAPPING {mapping.Name}; requested={css}; computed={style}; AX={string.Join(',', roles)}");
        var png = await page.ScreenshotAsync(new() { OmitBackground = true, Clip = new() { X = 0, Y = 0, Width = sw, Height = sh } });
        using var bitmap = SkiaSharp.SKBitmap.Decode(png);
        RectanglePixels.CheckNested("HTML/" + mapping.Name, bitmap.Width, bitmap.Height, width, height, scale, mode, alpha,
            (x, y) => { var p = bitmap.GetPixel(x, y); return (p.Red, p.Green, p.Blue, p.Alpha); });
    }
}
// Accumulate all strict clipping failures, then terminate nonzero; no failing samples are skipped.
RectanglePixels.ThrowIfNestedFailures();
