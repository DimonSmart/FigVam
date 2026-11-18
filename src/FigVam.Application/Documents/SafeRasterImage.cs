using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// Deliberately small PNG subset: no ancillary chunks, palette, interlace, or animation.
// Accept only complete 8-bit grayscale/RGB/gray-alpha/RGBA pixel streams with valid CRC and Adler checks.
public static class SafeRasterImage
{
    public static DocumentAsset? Inspect(Guid id, string? contentType, byte[]? content)
    {
        if (id == Guid.Empty || contentType != "image/png" || content is null || content.Length is < 57 or > DocumentAssetValidator.MaxAssetBytes)
            return null;
        try { return InspectPng(id, content); }
        catch (InvalidDataException) { return null; }
        catch (EndOfStreamException) { return null; }
    }

    private static DocumentAsset? InspectPng(Guid id, byte[] content)
    {
        ReadOnlySpan<byte> bytes = content;
        if (!bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return null;
        var offset = 8; int width = 0, height = 0, channels = 0, chunks = 0;
        var ended = false; var hasData = false;
        using var compressed = new MemoryStream();
        while (offset < bytes.Length)
        {
            if (++chunks > 1024 || bytes.Length - offset < 12) return null;
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes[offset..]);
            if (length > (uint)(bytes.Length - offset - 12)) return null;
            var size = (int)length;
            var type = bytes.Slice(offset + 4, 4);
            var data = bytes.Slice(offset + 8, size);
            if (Crc(bytes.Slice(offset + 4, size + 4)) != BinaryPrimitives.ReadUInt32BigEndian(bytes[(offset + 8 + size)..])) return null;
            if (type.SequenceEqual("IHDR"u8))
            {
                if (offset != 8 || size != 13 || data[8] != 8 || data[10] != 0 || data[11] != 0 || data[12] != 0) return null;
                var w = BinaryPrimitives.ReadUInt32BigEndian(data); var h = BinaryPrimitives.ReadUInt32BigEndian(data[4..]);
                if (w is 0 or > DocumentAssetValidator.MaxDimension || h is 0 or > DocumentAssetValidator.MaxDimension || (long)w * h > DocumentAssetValidator.MaxPixels) return null;
                width = (int)w; height = (int)h;
                channels = data[9] switch { 0 => 1, 2 => 3, 4 => 2, 6 => 4, _ => 0 };
                if (channels == 0) return null;
            }
            else if (type.SequenceEqual("IDAT"u8))
            {
                if (width == 0 || ended) return null;
                hasData = true; compressed.Write(data);
            }
            else if (type.SequenceEqual("IEND"u8))
            {
                if (!hasData || size != 0 || offset + 12 != bytes.Length) return null;
                ended = true;
            }
            else return null;
            offset += size + 12;
        }
        if (!ended || compressed.Length < 6) return null;
        var zlibBytes = compressed.ToArray();
        // Reject preset dictionaries and unsupported compression before decompression.
        if (zlibBytes[0] != 0x78 || (zlibBytes[1] & 0x20) != 0 || ((zlibBytes[0] << 8) + zlibBytes[1]) % 31 != 0) return null;
        using var zlibInput = new ExactZlibInput(zlibBytes);
        using var zlib = new ZLibStream(zlibInput, CompressionMode.Decompress, leaveOpen: true);
        var row = new byte[checked(width * channels + 1)];
        uint adlerA = 1, adlerB = 0;
        for (var y = 0; y < height; y++)
        {
            zlib.ReadExactly(row);
            if (row[0] > 4) return null;
            foreach (var b in row) { adlerA = (adlerA + b) % 65521; adlerB = (adlerB + adlerA) % 65521; }
        }
        if (zlib.ReadByte() != -1 || zlibInput.Position != zlibInput.Length || ((adlerB << 16) | adlerA) != BinaryPrimitives.ReadUInt32BigEndian(zlibBytes.AsSpan(zlibBytes.Length - 4))) return null;
        return new(id, "image/png", Convert.ToHexStringLower(SHA256.HashData(content)), content.Length, width, height);
    }

    // Prevent inflater read-ahead from hiding bytes after the zlib trailer.
    private sealed class ExactZlibInput(byte[] bytes) : MemoryStream(bytes, writable: false)
    {
        public override int Read(byte[] buffer, int offset, int count) => base.Read(buffer, offset, Math.Min(count, 1));
        public override int Read(Span<byte> buffer) => base.Read(buffer[..Math.Min(buffer.Length, 1)]);
    }

    private static uint Crc(ReadOnlySpan<byte> bytes)
    {
        uint crc = 0xffffffff;
        foreach (var b in bytes)
        {
            crc ^= b;
            for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u);
        }
        return ~crc;
    }
}
