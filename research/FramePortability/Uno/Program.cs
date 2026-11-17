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
            }
            Program.ExitCode = 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); }
        finally { window.Close(); }
    }
}
