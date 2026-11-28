using System.Text.RegularExpressions;

namespace FigVam.Domain.Documents;

public sealed record DocumentAsset(Guid Id, string ContentType, string Sha256, int ByteLength, int Width, int Height);

public static partial class DocumentAssetValidator
{
    public const int MaxAssets = 256;
    public const long MaxDocumentBytes = 64 * 1024 * 1024;
    public const int MaxAssetBytes = 5 * 1024 * 1024;
    public const int MaxDimension = 4096;
    public const int MaxPixels = 4 * 1024 * 1024;
    public static bool IsValid(IReadOnlyList<DocumentAsset>? assets) => assets is not null && assets.Count <= MaxAssets &&
        assets.All(a => a is not null && a.Id != Guid.Empty &&
            a.Sha256 is not null && HashPattern().IsMatch(a.Sha256) && a.ByteLength is > 0 and <= MaxAssetBytes &&
            (a.ContentType == "image/png" && a.Width is > 0 and <= MaxDimension && a.Height is > 0 and <= MaxDimension && (long)a.Width * a.Height <= MaxPixels ||
             DocumentFontValidator.IsFontContentType(a.ContentType) && a.Width == 0 && a.Height == 0)) &&
        assets.Select(a => a.Id).Distinct().Count() == assets.Count && assets.Sum(a => (long)a.ByteLength) <= MaxDocumentBytes;

    [GeneratedRegex("\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex HashPattern();
}
