using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

// Reject rather than rewrite unsafe input: stored bytes always match the validated SHA.
public static partial class SafeSvgImage
{
    private static readonly XNamespace Svg = "http://www.w3.org/2000/svg";
    private static readonly HashSet<string> Elements = new(StringComparer.Ordinal)
    {
        "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse",
        "line", "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath"
    };
    private static readonly HashSet<string> Attributes = new(StringComparer.Ordinal)
    {
        "id", "version", "viewBox", "width", "height", "preserveAspectRatio", "x", "y",
        "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points",
        "transform", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
        "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
        "opacity", "color", "display", "visibility", "vector-effect", "clip-path", "clip-rule", "clipPathUnits",
        "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity"
    };

    public static DocumentAsset? Inspect(Guid id, string? contentType, byte[]? content)
    {
        if (id == Guid.Empty || contentType != "image/svg+xml" || content is null ||
            content.Length is 0 or > DocumentAssetValidator.MaxAssetBytes) return null;
        try
        {
            using var stream = new MemoryStream(content, writable: false);
            using var reader = XmlReader.Create(stream, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = DocumentAssetValidator.MaxAssetBytes
            });
            // Validate depth before allocating an XML tree.
            while (reader.Read())
                if (reader.Depth > 64 || reader.NodeType == XmlNodeType.ProcessingInstruction) return null;
            stream.Position = 0;
            using var treeReader = XmlReader.Create(stream, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = DocumentAssetValidator.MaxAssetBytes
            });
            var doc = XDocument.Load(treeReader);
            if (doc.Root is not { } root || root.Name != Svg + "svg") return null;
            var count = 0;
            foreach (var element in root.DescendantsAndSelf())
            {
                if (++count > 10000 || element.Name.Namespace != Svg || !Elements.Contains(element.Name.LocalName)) return null;
                foreach (var attribute in element.Attributes())
                {
                    if (attribute.IsNamespaceDeclaration)
                    {
                        if (attribute.Value != Svg.NamespaceName) return null;
                        continue;
                    }
                    if (attribute.Name.Namespace != XNamespace.None || !Attributes.Contains(attribute.Name.LocalName)) return null;
                    var value = attribute.Value;
                    // No CSS escapes, comments, or remote URL forms. A paint/clip URL must be
                    // exactly a local fragment; all other attributes use ordinary SVG syntax.
                    if (value.Contains('\\') || value.Contains("/*", StringComparison.Ordinal)) return null;
                    if (value.Contains("url", StringComparison.OrdinalIgnoreCase) && !LocalUrl().IsMatch(value)) return null;
                    if (value.Contains("://", StringComparison.Ordinal) || value.Contains("data:", StringComparison.OrdinalIgnoreCase) ||
                        value.Contains("javascript:", StringComparison.OrdinalIgnoreCase)) return null;
                }
            }
            var viewBox = ((string?)root.Attribute("viewBox"))?.Split([' ', ',', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
            double vw = 0, vh = 0;
            if (viewBox is not null)
            {
                if (viewBox.Length != 4 || !Parse(viewBox[0], out _) || !Parse(viewBox[1], out _) ||
                    !Parse(viewBox[2], out vw) || !Parse(viewBox[3], out vh) || vw <= 0 || vh <= 0) return null;
            }
            if (!Dimension((string?)root.Attribute("width"), vw, out var width) ||
                !Dimension((string?)root.Attribute("height"), vh, out var height) ||
                (long)width * height > DocumentAssetValidator.MaxPixels) return null;
            return new(id, contentType, Convert.ToHexStringLower(SHA256.HashData(content)), content.Length, width, height);
        }
        catch (XmlException) { return null; }
    }

    private static bool Parse(string text, out double value) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && double.IsFinite(value);

    private static bool Dimension(string? text, double fallback, out int size)
    {
        size = 0;
        var value = fallback;
        if (text is not null && !Parse(text.EndsWith("px", StringComparison.Ordinal) ? text[..^2] : text, out value)) return false;
        if (value <= 0 || value > DocumentAssetValidator.MaxDimension) return false;
        size = (int)Math.Ceiling(value);
        return true;
    }

    [GeneratedRegex(@"\Aurl\(#[A-Za-z_][A-Za-z0-9_.:-]*\)\z", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex LocalUrl();
}
