using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public static class DocumentContainerFormat
{
    public static string AssetPath(Guid assetId) => AssetPath(assetId, "image/png");

    public static string AssetPath(DocumentAsset asset) => AssetPath(asset.Id, asset.ContentType);

    public static string AssetPath(Guid assetId, string contentType)
        => $"assets/{assetId:N}{DocumentAssetContentFormat.Extension(contentType) ?? throw new ArgumentException("Unsupported asset content type.", nameof(contentType))}";

    public static bool IsAssetPath(string path)
    {
        if (path.Length <= 39 || !path.StartsWith("assets/", StringComparison.Ordinal) ||
            !Guid.TryParseExact(path.AsSpan(7, 32), "N", out var id) || id == Guid.Empty)
            return false;
        var contentType = DocumentAssetContentFormat.ContentTypeForExtension(path[39..]);
        return contentType is not null && path == AssetPath(id, contentType);
    }
}
