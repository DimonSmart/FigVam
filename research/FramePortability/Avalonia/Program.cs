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
}
