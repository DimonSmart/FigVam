using System.Text.Json;
using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Markup.Xaml;
using Avalonia.Media.Imaging;

AppBuilder.Configure<Application>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();
using var cases = JsonDocument.Parse(File.ReadAllText(args[0]));
foreach (var item in cases.RootElement.EnumerateArray())
{
    var width = item.GetProperty("width").GetDouble();
    var height = item.GetProperty("height").GetDouble();
    var xml = FormattableString.Invariant($"<Grid xmlns='https://github.com/avaloniaui' Width='{width}' Height='{height}' UseLayoutRounding='False' />");
    var frame = (Grid)AvaloniaRuntimeXamlLoader.Load(xml);
    frame.Measure(new Size(640, 480));
    frame.Arrange(new Rect(0, 0, width, height));
    if (frame.Bounds.Width != width || frame.Bounds.Height != height || frame.Children.Count != 0 || frame.Focusable)
        throw new Exception("Frame geometry/container mismatch.");
    var peer = ControlAutomationPeer.CreatePeerForElement(frame);
    if (peer?.GetAutomationControlType() is { } role && role != AutomationControlType.None)
        throw new Exception("Unexpected automation peer role: " + role);
    using var image = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(width), (int)Math.Ceiling(height)), new Vector(96, 96));
    image.Render(frame);
    using var stream = new MemoryStream();
    image.Save(stream, PngBitmapEncoderOptions.Default);
    // Decode the rendered pixels, including alpha, independently of PNG compression.
    using var bitmap = SkiaSharp.SKBitmap.Decode(stream.ToArray());
    if (bitmap.Pixels.Any(p => p.Alpha != 0)) throw new Exception("Empty Frame unexpectedly paints pixels.");
    frame.Background = Avalonia.Media.Brushes.Red; // Harness calibration, not a proposed profile property.
    using var calibration = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(width), (int)Math.Ceiling(height)), new Vector(96, 96));
    calibration.Render(frame);
    using var calibrationStream = new MemoryStream();
    calibration.Save(calibrationStream, PngBitmapEncoderOptions.Default);
    using var calibrationBitmap = SkiaSharp.SKBitmap.Decode(calibrationStream.ToArray());
    if (!calibrationBitmap.Pixels.Any(p => p.Red > 0 && p.Alpha > 0)) throw new Exception("Renderer calibration failed.");
    Console.WriteLine($"PASS Avalonia Grid {width}x{height} logical units; empty nonfocusable Panel; automation role {peer?.GetAutomationControlType().ToString() ?? "absent"}; transparent bitmap {bitmap.Width}x{bitmap.Height}");
    foreach (var alpha in new[] { 255, 128 })
    {
        var rectangle = (Avalonia.Controls.Shapes.Rectangle)AvaloniaRuntimeXamlLoader.Load(FormattableString.Invariant($"<Rectangle xmlns='https://github.com/avaloniaui' Width='{width}' Height='{height}' Fill='#{alpha:X2}4080C0' UseLayoutRounding='False' IsHitTestVisible='False' Focusable='False' />"));
        rectangle.Measure(new Size(640,480));
        rectangle.Arrange(new Rect(0,0,width,height));
        if (rectangle.Bounds != new Rect(0,0,width,height) || rectangle.Focusable || rectangle.IsHitTestVisible)
            throw new Exception("Avalonia Rectangle geometry/semantics mismatch.");
        var rectanglePeer = ControlAutomationPeer.CreatePeerForElement(rectangle);
        var rectangleRole = rectanglePeer?.GetAutomationControlType();
        Console.WriteLine("RECTANGLE Avalonia automation role=" + (rectangleRole?.ToString() ?? "absent"));
        if (rectangleRole is not null && rectangleRole != AutomationControlType.None)
            throw new Exception("Avalonia Rectangle unexpected automation role.");
        using var rendered = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(width),(int)Math.Ceiling(height)),new Vector(96,96));
        rendered.Render(rectangle);
        using var rectangleStream = new MemoryStream();
        rendered.Save(rectangleStream,PngBitmapEncoderOptions.Default);
        using var rectangleBitmap = SkiaSharp.SKBitmap.Decode(rectangleStream.ToArray());
        RectanglePixels.Check("Avalonia",rectangleBitmap.Width,rectangleBitmap.Height,width,height,1,alpha,
            (x,y) => { var p = rectangleBitmap.GetPixel(x,y); return (p.Red,p.Green,p.Blue,p.Alpha); });
    }
    foreach (var mode in new[] { "offset", "visible", "clip" })
    foreach (var alpha in new[] { 255, 128 })
    {
        var cx=mode == "offset" ? .25 : -2.25;
        var cy=mode == "offset" ? .375 : -3.375;
        var cw=width+(mode == "offset" ? 0 : 4.5);
        var ch=height+(mode == "offset" ? 0 : 6.75);
        var sw=(int)Math.Ceiling(width)+24;var sh=(int)Math.Ceiling(height)+24;
        var stage=new Canvas { Width=sw,Height=sh,UseLayoutRounding=false };
        var parent=new Canvas { Width=width,Height=height,UseLayoutRounding=false };
        Canvas.SetLeft(parent,8);Canvas.SetTop(parent,8);stage.Children.Add(parent);
        if(mode == "clip") parent.Clip=new Avalonia.Media.RectangleGeometry(new Rect(0,0,width,height));
        var child=new Avalonia.Controls.Shapes.Rectangle {Width=cw,Height=ch,UseLayoutRounding=false,Focusable=false,IsHitTestVisible=false,Fill=new Avalonia.Media.SolidColorBrush(Avalonia.Media.Color.FromArgb((byte)alpha,64,128,192))};
        Canvas.SetLeft(child,cx);Canvas.SetTop(child,cy);parent.Children.Add(child);
        stage.Measure(new Size(sw,sh));stage.Arrange(new Rect(0,0,sw,sh));
        if(parent.Bounds!=new Rect(8,8,width,height)||child.Bounds!=new Rect(cx,cy,cw,ch))throw new Exception("Avalonia nested bounds mismatch.");
        var parentRole=ControlAutomationPeer.CreatePeerForElement(parent)?.GetAutomationControlType();
        var childRole=ControlAutomationPeer.CreatePeerForElement(child)?.GetAutomationControlType();
        if(parentRole is not null && parentRole!=AutomationControlType.None || childRole is not null && childRole!=AutomationControlType.None || child.Focusable || child.IsHitTestVisible)throw new Exception("Avalonia nested semantics mismatch.");
        Console.WriteLine($"NESTED Avalonia parent/child role={parentRole}/{childRole}; child nonfocusable/non-hit-testable");
        using var capture=new RenderTargetBitmap(new PixelSize(sw,sh),new Vector(96,96));capture.Render(stage);
        using var output=new MemoryStream();capture.Save(output,PngBitmapEncoderOptions.Default);
        using var decoded=SkiaSharp.SKBitmap.Decode(output.ToArray());
        RectanglePixels.CheckNested("Avalonia",decoded.Width,decoded.Height,width,height,1,mode,alpha,(x,y)=>{var p=decoded.GetPixel(x,y);return(p.Red,p.Green,p.Blue,p.Alpha);});
    }
}

RectanglePixels.ThrowIfNestedFailures();
