namespace FigVam.Domain.Documents;

public enum DocumentFontStyle { Normal, Italic }

public sealed record DocumentFontFace(Guid Id, Guid AssetId, string Name,
    int WeightFrom, int WeightTo, DocumentFontStyle Style);

public sealed record DocumentFontFamily(Guid Id, string Name, IReadOnlyList<DocumentFontFace> Faces);

public static class DocumentFontValidator
{
    public const int MaxFamilies = 64;
    public const int MaxFaces = 128;
    public const long MaxBytes = 32 * 1024 * 1024;
    public const int MaxNameLength = 256;

    public static bool IsFontContentType(string? contentType) =>
        contentType is "font/woff2" or "font/woff" or "font/ttf" or "font/otf";

    public static bool IsValid(IReadOnlyList<DocumentFontFamily>? families, IReadOnlyList<DocumentAsset>? assets)
    {
        if (families is null || assets is null || families.Count > MaxFamilies)
            return false;
        var byId = new Dictionary<Guid, DocumentAsset>();
        foreach (var asset in assets)
            if (asset is null || asset.Id == Guid.Empty || !byId.TryAdd(asset.Id, asset))
                return false;
        var ids = new HashSet<Guid>(byId.Keys);
        var usedAssets = new HashSet<Guid>();
        var hashes = new HashSet<string>(StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var count = 0;
        long bytes = 0;
        foreach (var family in families)
        {
            if (family is null || family.Id == Guid.Empty || !ids.Add(family.Id) || !ValidName(family.Name) || family.Name.Length > 128 || !names.Add(family.Name) ||
                !System.Text.RegularExpressions.Regex.IsMatch(family.Name, @"\A[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*\z", System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
                family.Faces is null || family.Faces.Count is 0 or > MaxFaces)
                return false;
            var ranges = new List<DocumentFontFace>();
            foreach (var face in family.Faces)
            {
                if (++count > MaxFaces || !ValidFace(face) || !ids.Add(face.Id) ||
                    !usedAssets.Add(face.AssetId) || !byId.TryGetValue(face.AssetId, out var asset) ||
                    !IsFontContentType(asset.ContentType) || asset.ByteLength is <= 0 or > DocumentAssetValidator.MaxAssetBytes ||
                    string.IsNullOrWhiteSpace(asset.Sha256) || !hashes.Add(asset.Sha256))
                    return false;
                bytes += asset.ByteLength;
                if (bytes > MaxBytes || ranges.Any(existing => Overlaps(existing, face)))
                    return false;
                ranges.Add(face);
            }
        }
        return assets.Where(a => IsFontContentType(a.ContentType)).All(a => usedAssets.Contains(a.Id));
    }

    public static bool ValidFace(DocumentFontFace? face) => face is not null &&
        face.Id != Guid.Empty && face.AssetId != Guid.Empty && ValidName(face.Name) &&
        face.WeightFrom is >= 1 and <= 1000 && face.WeightTo >= face.WeightFrom && face.WeightTo <= 1000 &&
        Enum.IsDefined(face.Style);

    public static bool Overlaps(DocumentFontFace left, DocumentFontFace right) =>
        left.Style == right.Style && left.WeightFrom <= right.WeightTo && right.WeightFrom <= left.WeightTo;

    private static bool ValidName(string? name) => !string.IsNullOrWhiteSpace(name) &&
        name.Length <= MaxNameLength && !name.Any(char.IsControl);
}
