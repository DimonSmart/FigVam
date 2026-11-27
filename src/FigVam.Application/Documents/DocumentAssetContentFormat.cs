using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// One dispatch boundary for uploads, portable containers and transactional storage.
// Unknown formats must fail closed until they have an authoritative inspector.
public static class DocumentAssetContentFormat
{
    public static bool IsSupported(string? contentType) => Extension(contentType) is not null;

    public static string? Extension(string? contentType) => contentType switch
    {
        "image/png" => ".png",
        _ => null
    };

    public static string? ContentTypeForExtension(string extension) => extension switch
    {
        ".png" => "image/png",
        _ => null
    };

    public static DocumentAsset? Inspect(Guid id, string? contentType, byte[]? content) => contentType switch
    {
        "image/png" => SafeRasterImage.Inspect(id, contentType, content),
        _ => null
    };
}
