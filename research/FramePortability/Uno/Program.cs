using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Uno.UI.Hosting;
using System.Text.Json;
using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Media.Imaging;

internal static class Program
{
    internal static string CasePath;
    internal static int ExitCode = 1;
    [STAThread]
    private static int Main(string[] args)
    {
        CasePath = args[0];
        UnoPlatformHostBuilder.Create().App(() => new ProbeApp()).UseWin32().Build().Run();
        return ExitCode;
    }
}

internal sealed class ProbeApp : Application
{
    private Window window;
    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        window = new Window();
        window.Activate();
        try
        {
            using var cases = JsonDocument.Parse(File.ReadAllText(Program.CasePath));
            foreach (var item in cases.RootElement.EnumerateArray())
            {
                var width = item.GetProperty("width").GetDouble();
                var height = item.GetProperty("height").GetDouble();
                var xml = FormattableString.Invariant($"<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Width='{width}' Height='{height}' UseLayoutRounding='False' HorizontalAlignment='Left' VerticalAlignment='Top' />");
                var frame = (Grid)XamlReader.Load(xml);
                var loaded = new TaskCompletionSource();
                frame.Loaded += (_, _) => loaded.TrySetResult();
                window.Content = new Grid { UseLayoutRounding = false, Children = { frame } };
                await loaded.Task.WaitAsync(TimeSpan.FromSeconds(15));
                frame.UpdateLayout();
                if (Math.Abs(frame.ActualWidth - width) > 0.0001 || Math.Abs(frame.ActualHeight - height) > 0.0001 || frame.Children.Count != 0)
                    throw new Exception($"Uno Frame geometry/container mismatch: {frame.ActualWidth}x{frame.ActualHeight}.");
                var peer = FrameworkElementAutomationPeer.CreatePeerForElement(frame);
                Console.WriteLine("Uno automation peer: " + (peer?.GetAutomationControlType().ToString() ?? "absent"));
                if (peer != null) throw new Exception("Unexpected automation peer.");
                var bitmap = new RenderTargetBitmap();
                await bitmap.RenderAsync(frame);
                var pixels = (await bitmap.GetPixelsAsync()).ToArray();
                if (pixels.Length == 0 || pixels.Any(b => b != 0)) throw new Exception("Empty Frame bitmap mismatch.");
                frame.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Red); // Harness calibration only.
                var calibration = new RenderTargetBitmap();
                await calibration.RenderAsync(frame);
                if (!(await calibration.GetPixelsAsync()).ToArray().Any(b => b != 0)) throw new Exception("Renderer calibration failed.");
                Console.WriteLine($"PASS Uno Grid {frame.ActualWidth}x{frame.ActualHeight} logical units; empty Panel; absent automation peer; scale={frame.XamlRoot.RasterizationScale}; transparent bitmap {bitmap.PixelWidth}x{bitmap.PixelHeight}");
                foreach (var alpha in new[] { 255, 128 })
                {
                    var rectangle = (Microsoft.UI.Xaml.Shapes.Rectangle)XamlReader.Load(FormattableString.Invariant($"<Rectangle xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Width='{width}' Height='{height}' Fill='#{alpha:X2}4080C0' UseLayoutRounding='False' IsHitTestVisible='False' HorizontalAlignment='Left' VerticalAlignment='Top' />"));
                    var rectangleLoaded = new TaskCompletionSource();
                    rectangle.Loaded += (_,_) => rectangleLoaded.TrySetResult();
                    window.Content = new Grid { UseLayoutRounding = false, Children = { rectangle } };
                    await rectangleLoaded.Task.WaitAsync(TimeSpan.FromSeconds(15));
                    rectangle.UpdateLayout();
                    if (Math.Abs(rectangle.ActualWidth-width) > 0.0001 || Math.Abs(rectangle.ActualHeight-height) > 0.0001 || rectangle.IsHitTestVisible)
                        throw new Exception("Uno Rectangle geometry/semantics mismatch.");
                    var rectanglePeer = FrameworkElementAutomationPeer.CreatePeerForElement(rectangle);
                    Console.WriteLine("RECTANGLE Uno automation peer=" + (rectanglePeer?.GetAutomationControlType().ToString() ?? "absent"));
                    if (rectanglePeer != null) throw new Exception("Uno Rectangle unexpected peer.");
                    var rendered = new RenderTargetBitmap();
                    await rendered.RenderAsync(rectangle);
                    var bytes = (await rendered.GetPixelsAsync()).ToArray();
                    RectanglePixels.Check("Uno",rendered.PixelWidth,rendered.PixelHeight,rectangle.ActualWidth,rectangle.ActualHeight,
                        rectangle.XamlRoot.RasterizationScale,alpha,
                        (x,y) => RectanglePixels.FromPremultiplied(bytes,(y * rendered.PixelWidth+x)*4));
                }
                foreach (var mode in new[] { "offset", "visible", "clip" })
                foreach (var alpha in new[] { 255, 128 })
                {
                    var cx=mode == "offset" ? .25 : -2.25;
                    var cy=mode == "offset" ? .375 : -3.375;
                    var cw=width+(mode == "offset" ? 0 : 4.5);
                    var ch=height+(mode == "offset" ? 0 : 6.75);
                    var sw=(int)Math.Ceiling(width)+24;var sh=(int)Math.Ceiling(height)+24;
                    var stage=new Canvas {Width=sw,Height=sh,UseLayoutRounding=false,HorizontalAlignment=HorizontalAlignment.Left,VerticalAlignment=VerticalAlignment.Top};
                    var parent=new Canvas {Width=width,Height=height,UseLayoutRounding=false};
                    Canvas.SetLeft(parent,8);Canvas.SetTop(parent,8);stage.Children.Add(parent);
                    if(mode == "clip")parent.Clip=new Microsoft.UI.Xaml.Media.RectangleGeometry {Rect=new Windows.Foundation.Rect(0,0,width,height)};
                    var child=new Microsoft.UI.Xaml.Shapes.Rectangle {Width=cw,Height=ch,UseLayoutRounding=false,IsHitTestVisible=false,Fill=new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb((byte)alpha,64,128,192))};
                    Canvas.SetLeft(child,cx);Canvas.SetTop(child,cy);parent.Children.Add(child);
                    var ready=new TaskCompletionSource();stage.Loaded+=(_,_)=>ready.TrySetResult();
                    window.Content=new Grid {UseLayoutRounding=false,Children={stage}};
                    await ready.Task.WaitAsync(TimeSpan.FromSeconds(15));stage.UpdateLayout();
                    var fp=parent.TransformToVisual(stage).TransformPoint(new Windows.Foundation.Point());
                    var cp=child.TransformToVisual(parent).TransformPoint(new Windows.Foundation.Point());
                    if(Math.Abs(fp.X-8)>.0001||Math.Abs(fp.Y-8)>.0001||Math.Abs(cp.X-cx)>.0001||Math.Abs(cp.Y-cy)>.0001||Math.Abs(parent.ActualWidth-width)>.0001||Math.Abs(parent.ActualHeight-height)>.0001||Math.Abs(child.ActualWidth-cw)>.0001||Math.Abs(child.ActualHeight-ch)>.0001)throw new Exception($"Uno nested bounds mismatch {fp}/{cp}, {parent.ActualWidth}x{parent.ActualHeight}, {child.ActualWidth}x{child.ActualHeight}.");
                    if(FrameworkElementAutomationPeer.CreatePeerForElement(parent)!=null||FrameworkElementAutomationPeer.CreatePeerForElement(child)!=null||child.IsHitTestVisible)throw new Exception("Uno nested semantics mismatch.");
                    Console.WriteLine("NESTED Uno parent/child peer=absent; child non-hit-testable");
                    var capture=new RenderTargetBitmap();await capture.RenderAsync(stage);var data=(await capture.GetPixelsAsync()).ToArray();
                    RectanglePixels.CheckNested("Uno",capture.PixelWidth,capture.PixelHeight,width,height,stage.XamlRoot.RasterizationScale,mode,alpha,(x,y)=>RectanglePixels.FromPremultiplied(data,(y*capture.PixelWidth+x)*4));
                }
            }
            RectanglePixels.ThrowIfNestedFailures();
            Program.ExitCode = 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); }
        finally { window.Close(); }
    }
}
