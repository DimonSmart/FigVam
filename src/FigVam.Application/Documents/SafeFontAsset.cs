using System.Buffers.Binary;
using System.Security.Cryptography;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// Bound the file and declared decoded size before handing font bytes to Chromium's
// OpenType Sanitizer. No fonts are installed in the host OS or parsed as executable code.
public static class SafeFontAsset
{
    public static DocumentAsset? Inspect(Guid id, string? contentType, byte[]? content)
    {
        if (id == Guid.Empty || content is null || content.Length is < 12 or > DocumentAssetValidator.MaxAssetBytes)
            return null;
        var bytes = content.AsSpan();
        static uint U32(ReadOnlySpan<byte> s, int offset) => BinaryPrimitives.ReadUInt32BigEndian(s[offset..]);
        static ushort U16(ReadOnlySpan<byte> s, int offset) => BinaryPrimitives.ReadUInt16BigEndian(s[offset..]);
        var magic = U32(bytes, 0);
        if (contentType is "font/woff" or "font/woff2")
        {
            var woff2 = contentType == "font/woff2";
            if (magic != (woff2 ? 0x774F4632u : 0x774F4646u) || bytes.Length < (woff2 ? 48 : 44) ||
                U32(bytes, 8) != bytes.Length || U16(bytes, 12) is 0 or > 256 ||
                U16(bytes, 14) != 0 || U32(bytes, 16) is < 12 or > 32 * 1024 * 1024 ||
                U32(bytes, 4) is not (0x00010000u or 0x4F54544Fu))
                return null;
            if (woff2)
            {
                if (U32(bytes, 20) == 0 || U32(bytes, 20) > bytes.Length - 48) return null;
            }
            else
            {
                var count = U16(bytes, 12);
                if (44 + count * 20 > bytes.Length) return null;
                for (var i = 0; i < count; i++)
                {
                    var pos = 44 + i * 20;
                    var offset = U32(bytes, pos + 4);
                    var compressed = U32(bytes, pos + 8);
                    var original = U32(bytes, pos + 12);
                    if (offset < 44 + count * 20 || compressed > original ||
                        original > 32 * 1024 * 1024 || (ulong)offset + compressed > (ulong)bytes.Length)
                        return null;
                }
            }
        }
        else if (contentType is "font/ttf" or "font/otf")
        {
            if (magic != (contentType == "font/ttf" ? 0x00010000u : 0x4F54544Fu)) return null;
            var count = U16(bytes, 4);
            if (count is 0 or > 256 || 12 + count * 16 > bytes.Length) return null;
            for (var i = 0; i < count; i++)
            {
                var pos = 12 + i * 16;
                var offset = U32(bytes, pos + 8);
                var length = U32(bytes, pos + 12);
                if (offset < 12 + count * 16 || (ulong)offset + length > (ulong)bytes.Length) return null;
            }
        }
        else return null;
        return new(id, contentType, Convert.ToHexStringLower(SHA256.HashData(content)), content.Length, 0, 0);
    }
}
