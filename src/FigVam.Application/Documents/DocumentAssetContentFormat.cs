using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// One format registry for upload transports, container extensions and content validation.
public static class DocumentAssetContentFormat
{
    private sealed record Format(string Extension, Func<Guid, string?, byte[]?, DocumentAsset?> Inspect);

    private static readonly IReadOnlyDictionary<string, Format> Formats =
        new Dictionary<string, Format>(StringComparer.Ordinal)
        {
            ["image/png"] = new(".png", SafeRasterImage.Inspect),
            ["image/svg+xml"] = new(".svg", SafeSvgImage.Inspect),
            ["font/woff2"] = new(".woff2", SafeFontAsset.Inspect),
            ["font/woff"] = new(".woff", SafeFontAsset.Inspect),
            ["font/ttf"] = new(".ttf", SafeFontAsset.Inspect),
            ["font/otf"] = new(".otf", SafeFontAsset.Inspect)
        };

    public static IReadOnlyList<string> SupportedContentTypes { get; } =
        Array.AsReadOnly(Formats.Keys.Order(StringComparer.Ordinal).ToArray());

    public static bool IsSupported(string? contentType) => contentType is not null && Formats.ContainsKey(contentType);

    public static string? Extension(string? contentType) =>
        contentType is not null && Formats.TryGetValue(contentType, out var format) ? format.Extension : null;

    public static string? ContentTypeForExtension(string extension) =>
        Formats.FirstOrDefault(pair => pair.Value.Extension == extension).Key;

    public static DocumentAsset? Inspect(Guid id, string? contentType, byte[]? content) =>
        contentType is not null && Formats.TryGetValue(contentType, out var format)
            ? format.Inspect(id, contentType, content) : null;
}
