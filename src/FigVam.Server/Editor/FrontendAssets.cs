using System.Text.RegularExpressions;

namespace FigVam.Server.Editor;

internal static class FrontendAssets
{
    public static IEnumerable<string> Chunks()
    {
        var directory = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        return Directory.Exists(directory)
            ? Directory.EnumerateFiles(directory, "figvam-chunk-*.js")
                .Where(file => Regex.IsMatch(Path.GetFileName(file), @"\Afigvam-chunk-[A-Za-z0-9_-]+\.js\z", RegexOptions.CultureInvariant))
            : Enumerable.Empty<string>();
    }
}
