using System.Text.Json;
using Microsoft.Playwright;

using var playwright = await Playwright.CreateAsync();
await using var browser = await playwright.Chromium.LaunchAsync(new() { Headless = true, Channel = "msedge" });
Console.WriteLine("Edge/Chromium " + browser.Version);
using var cases = JsonDocument.Parse(File.ReadAllText(args[0]));
foreach (var scale in new[] { 1f, 1.5f, 2f })
{
    await using var context = await browser.NewContextAsync(new() { ViewportSize = new() { Width = 640, Height = 480 }, DeviceScaleFactor = scale, ColorScheme = ColorScheme.Light });
    var page = await context.NewPageAsync();
    foreach (var item in cases.RootElement.EnumerateArray())
    {
        var width = item.GetProperty("width").GetDouble();
        var height = item.GetProperty("height").GetDouble();
        await page.SetContentAsync(FormattableString.Invariant($"<!doctype html><html><body style='margin:0'><div id='frame' style='width:{width}px;height:{height}px'></div></body></html>"));
        var result = await page.EvaluateAsync<bool>("""
            ({width,height}) => {
              const f = document.querySelector('#frame'), r = f.getBoundingClientRect(), s = getComputedStyle(f);
              return r.width === width && r.height === height && f.children.length === 0 && f.tagName === 'DIV' &&
                f.tabIndex === -1 && !f.hasAttribute('role') && s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.display === 'block';
            }
            """, new { width, height });
        if (!result) throw new Exception("HTML Frame geometry/container mismatch.");
        var session = await context.NewCDPSessionAsync(page);
        var tree = await session.SendAsync("Accessibility.getFullAXTree");
        var interactive = tree.Value.GetProperty("nodes").EnumerateArray().Any(n => n.TryGetProperty("role", out var r) && new[] { "button", "textbox", "checkbox", "link" }.Contains(r.GetProperty("value").GetString()));
        if (interactive) throw new Exception("Empty container has unexpected interactive accessibility role.");
        var png = await page.ScreenshotAsync(new() { OmitBackground = true, Clip = new() { X = 0, Y = 0, Width = (float)width, Height = (float)height } });
        using var bitmap = SkiaSharp.SKBitmap.Decode(png);
        if (bitmap.Pixels.Any(p => p.Alpha != 0)) throw new Exception("Empty Frame unexpectedly paints pixels.");
        // Harness calibration, not a proposed profile property.
        await page.EvaluateAsync("document.querySelector('#frame').style.backgroundColor = 'red'");
        var calibrationPng = await page.ScreenshotAsync(new() { OmitBackground = true, Clip = new() { X = 0, Y = 0, Width = (float)width, Height = (float)height } });
        using var calibration = SkiaSharp.SKBitmap.Decode(calibrationPng);
        if (!calibration.Pixels.Any(p => p.Red > 0 && p.Alpha > 0)) throw new Exception("Renderer calibration failed.");
        Console.WriteLine($"PASS HTML div {width}x{height} CSS px DPR={scale}; empty nonfocusable generic container; no interactive AX role; PNG rendered ({png.Length} bytes)");
    }
}
