namespace FigVam.Application.Documents;

public static class DocumentContainerFormat
{
    public static string AssetPath(Guid assetId) => $"assets/{assetId:N}.png";

    public static bool IsAssetPath(string path) => path.Length == 43 &&
        path.StartsWith("assets/", StringComparison.Ordinal) && path.EndsWith(".png", StringComparison.Ordinal) &&
        Guid.TryParseExact(path.AsSpan(7, 32), "N", out var id) && id != Guid.Empty && path == AssetPath(id);
}
