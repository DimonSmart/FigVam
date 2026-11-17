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
        }
    }
}
