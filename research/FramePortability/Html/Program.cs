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
        foreach (var alpha in new[] { 255, 128 })
        {
            await page.SetContentAsync(FormattableString.Invariant($"<!doctype html><html><body style='margin:0'><div id='rectangle' style='width:{width}px;height:{height}px;background:rgba(64,128,192,{alpha / 255.0});pointer-events:none'></div></body></html>"));
            var geometry = await page.EvaluateAsync<bool>("""
                ({width,height}) => {
                  const f = document.querySelector('#rectangle'), r = f.getBoundingClientRect();
                  return r.x === 0 && r.y === 0 && r.width === width && r.height === height &&
                    f.children.length === 0 && f.tabIndex === -1 && !f.hasAttribute('role') &&
                    getComputedStyle(f).pointerEvents === 'none';
                }
                """, new { width, height });
            if (!geometry) throw new Exception("HTML Rectangle geometry/semantics mismatch.");
            var rectangleTree = await session.SendAsync("Accessibility.getFullAXTree");
            var roles = rectangleTree.Value.GetProperty("nodes").EnumerateArray()
                .Where(n => !n.GetProperty("ignored").GetBoolean())
                .Select(n => n.GetProperty("role").GetProperty("value").GetString()).ToArray();
            if (roles.Any(r => r is "button" or "textbox" or "checkbox" or "link" or "image"))
                throw new Exception("HTML Rectangle unexpected AX semantics.");
            Console.WriteLine("RECTANGLE HTML unignored AX roles=" + string.Join(',', roles));
            var rectanglePng = await page.ScreenshotAsync(new() { OmitBackground = true, Clip = new() { X = 0, Y = 0, Width = (float)width, Height = (float)height } });
            using var rectangleBitmap = SkiaSharp.SKBitmap.Decode(rectanglePng);
            RectanglePixels.Check("HTML", rectangleBitmap.Width, rectangleBitmap.Height, width, height, scale, alpha,
                (x,y) => { var p = rectangleBitmap.GetPixel(x,y); return (p.Red,p.Green,p.Blue,p.Alpha); });
        }
        foreach (var mode in new[] { "offset", "visible", "clip" })
        foreach (var alpha in new[] { 255, 128 })
        {
            var clipped = mode == "clip";
            var cx = mode == "offset" ? .25 : -2.25;
            var cy = mode == "offset" ? .375 : -3.375;
            var cw = width + (mode == "offset" ? 0 : 4.5);
            var ch = height + (mode == "offset" ? 0 : 6.75);
            var sw = (int)Math.Ceiling(width)+24;
            var sh = (int)Math.Ceiling(height)+24;
            await page.SetContentAsync(FormattableString.Invariant($"<!doctype html><html><body style='margin:0'><div id='stage' style='width:{sw}px;height:{sh}px;position:relative'><div id='frame' style='position:absolute;left:8px;top:8px;width:{width}px;height:{height}px;overflow:{(clipped ? "hidden" : "visible")}'><div id='child' style='position:absolute;left:{cx}px;top:{cy}px;width:{cw}px;height:{ch}px;background:rgba(64,128,192,{alpha/255.0});pointer-events:none'></div></div></div></body></html>"));
            var measured = await page.EvaluateAsync<double[]>("""
                () => { const f=document.querySelector('#frame').getBoundingClientRect(), c=document.querySelector('#child').getBoundingClientRect(); return [f.x,f.y,f.width,f.height,c.x-f.x,c.y-f.y,c.width,c.height]; }
                """);
            if (!measured.SequenceEqual(new[] {8d,8d,width,height,cx,cy,cw,ch})) throw new Exception("HTML nested bounds mismatch.");
            var ax = await session.SendAsync("Accessibility.getFullAXTree");
            var nestedRoles = ax.Value.GetProperty("nodes").EnumerateArray().Where(n=>!n.GetProperty("ignored").GetBoolean()).Select(n=>n.GetProperty("role").GetProperty("value").GetString()).ToArray();
            if (nestedRoles.Any(r=>r is "button" or "textbox" or "checkbox" or "link" or "image")) throw new Exception("HTML nested unexpected role.");
            Console.WriteLine("NESTED HTML AX roles="+string.Join(',',nestedRoles));
            var pngNested = await page.ScreenshotAsync(new() { OmitBackground=true, Clip=new() { X=0,Y=0,Width=sw,Height=sh } });
            using var nested = SkiaSharp.SKBitmap.Decode(pngNested);
            RectanglePixels.CheckNested("HTML",nested.Width,nested.Height,width,height,scale,mode,alpha,
                (x,y)=> {var p=nested.GetPixel(x,y);return(p.Red,p.Green,p.Blue,p.Alpha);});
        }
    }
}

RectanglePixels.ThrowIfNestedFailures();
