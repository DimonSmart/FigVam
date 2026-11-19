using System.Text.Json;
using System.IO;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var cases = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var item in cases.RootElement.EnumerateArray())
        {
            var width = item.GetProperty("width").GetDouble();
            var height = item.GetProperty("height").GetDouble();
            var xml = FormattableString.Invariant($"<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Width='{width}' Height='{height}' />");
            var frame = (Grid)XamlReader.Parse(xml);
            frame.Measure(new Size(640, 480));
            frame.Arrange(new Rect(0, 0, width, height));
            frame.UpdateLayout();
            if (frame.ActualWidth != width || frame.ActualHeight != height || frame.Children.Count != 0 || frame.Focusable)
                throw new Exception("Frame geometry/container mismatch.");
            var peer = UIElementAutomationPeer.CreatePeerForElement(frame);
            if (peer != null) throw new Exception("Unexpected automation peer: " + peer.GetAutomationControlType());
            var image = new RenderTargetBitmap((int)Math.Ceiling(width), (int)Math.Ceiling(height), 96, 96, PixelFormats.Pbgra32);
            image.Render(frame);
            var pixels = new byte[image.PixelWidth * image.PixelHeight * 4];
            image.CopyPixels(pixels, image.PixelWidth * 4, 0);
            if (pixels.Any(b => b != 0)) throw new Exception("Empty Frame unexpectedly paints pixels.");
            frame.Background = Brushes.Red; // Harness calibration, not a proposed profile property.
            frame.InvalidateMeasure();
            frame.Measure(new Size(640, 480));
            frame.Arrange(new Rect(0, 0, width, height));
            frame.UpdateLayout();
            var calibration = new RenderTargetBitmap(image.PixelWidth, image.PixelHeight, 96, 96, PixelFormats.Pbgra32);
            calibration.Render(frame);
            calibration.CopyPixels(pixels, image.PixelWidth * 4, 0);
            if (!pixels.Any(b => b != 0)) throw new Exception("Renderer calibration failed.");
            Console.WriteLine($"PASS WPF Grid {width}x{height} DIP; empty nonfocusable Panel; automation peer absent; transparent bitmap {image.PixelWidth}x{image.PixelHeight}");
            foreach (var alpha in new[] { 255, 128 })
            {
                var rectangle = (System.Windows.Shapes.Rectangle)XamlReader.Parse(FormattableString.Invariant($"<Rectangle xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Width='{width}' Height='{height}' Fill='#{alpha:X2}4080C0' IsHitTestVisible='False' Focusable='False' />"));
                rectangle.Measure(new Size(640,480));
                rectangle.Arrange(new Rect(0,0,width,height));
                rectangle.UpdateLayout();
                if (rectangle.ActualWidth != width || rectangle.ActualHeight != height || rectangle.Focusable || rectangle.IsHitTestVisible)
                    throw new Exception("WPF Rectangle geometry/semantics mismatch.");
                var rectanglePeer = UIElementAutomationPeer.CreatePeerForElement(rectangle);
                Console.WriteLine("RECTANGLE WPF automation peer=" + (rectanglePeer?.GetAutomationControlType().ToString() ?? "absent"));
                if (rectanglePeer != null) throw new Exception("WPF Rectangle unexpected peer.");
                var rendered = new RenderTargetBitmap(image.PixelWidth,image.PixelHeight,96,96,PixelFormats.Pbgra32);
                rendered.Render(rectangle);
                var bytes = new byte[rendered.PixelWidth * rendered.PixelHeight * 4];
                rendered.CopyPixels(bytes,rendered.PixelWidth * 4,0);
                RectanglePixels.Check("WPF",rendered.PixelWidth,rendered.PixelHeight,width,height,1,alpha,
                    (x,y) => RectanglePixels.FromPremultiplied(bytes,(y * rendered.PixelWidth + x) * 4));
            }
            foreach (var mode in new[] { "offset", "visible", "clip" })
            foreach (var alpha in new[] { 255, 128 })
            {
                var cx = mode == "offset" ? .25 : -2.25;
                var cy = mode == "offset" ? .375 : -3.375;
                var cw = width+(mode == "offset" ? 0 : 4.5);
                var ch = height+(mode == "offset" ? 0 : 6.75);
                var sw = (int)Math.Ceiling(width)+24;
                var sh = (int)Math.Ceiling(height)+24;
                var stage = new Canvas { Width=sw, Height=sh, UseLayoutRounding=false };
                var parent = new Canvas { Width=width, Height=height, UseLayoutRounding=false };
                Canvas.SetLeft(parent,8); Canvas.SetTop(parent,8); stage.Children.Add(parent);
                if (mode == "clip") parent.Clip = new RectangleGeometry(new Rect(0,0,width,height));
                var child = new System.Windows.Shapes.Rectangle { Width=cw,Height=ch,Fill=new SolidColorBrush(Color.FromArgb((byte)alpha,64,128,192)),Focusable=false,IsHitTestVisible=false,UseLayoutRounding=false };
                Canvas.SetLeft(child,cx); Canvas.SetTop(child,cy); parent.Children.Add(child);
                stage.Measure(new Size(sw,sh)); stage.Arrange(new Rect(0,0,sw,sh)); stage.UpdateLayout();
                var fp=parent.TranslatePoint(new Point(),stage); var cp=child.TranslatePoint(new Point(),parent);
                if (fp != new Point(8,8) || cp != new Point(cx,cy) || parent.ActualWidth!=width || parent.ActualHeight!=height || child.ActualWidth!=cw || child.ActualHeight!=ch)
                    throw new Exception("WPF nested bounds mismatch.");
                if (UIElementAutomationPeer.CreatePeerForElement(parent)!=null || UIElementAutomationPeer.CreatePeerForElement(child)!=null || child.Focusable || child.IsHitTestVisible) throw new Exception("WPF nested semantics mismatch.");
                Console.WriteLine("NESTED WPF parent/child peer=absent; child nonfocusable/non-hit-testable");
                var capture=new RenderTargetBitmap(sw,sh,96,96,PixelFormats.Pbgra32);capture.Render(stage);
                var data=new byte[sw*sh*4]; capture.CopyPixels(data,sw*4,0);
                RectanglePixels.CheckNested("WPF",sw,sh,width,height,1,mode,alpha,(x,y)=>RectanglePixels.FromPremultiplied(data,(y*sw+x)*4));
            }
        }
        RectanglePixels.ThrowIfNestedFailures();
    }
}
