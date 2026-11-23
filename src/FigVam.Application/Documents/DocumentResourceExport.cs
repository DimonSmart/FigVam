using System.Globalization;
using System.Text;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

public sealed record PortableTokenResource(Guid Id, string Name, TokenType Type, TokenCategory? Category,
    IReadOnlyDictionary<TokenTheme, TokenValue> Effective, IReadOnlyList<Guid> References);
public sealed record PortableStyleResource(Guid Id, string Name, DesignStyleType Type, Guid? BasedOnStyleId,
    IReadOnlyDictionary<string, NodePropertyValue> Fields,
    IReadOnlyDictionary<TokenTheme, IReadOnlyDictionary<string, NodePropertyValue>> Effective);
public sealed record PortableResourceSnapshot(Guid DocumentId, long Revision,
    IReadOnlyList<PortableTokenResource> Tokens, IReadOnlyList<PortableStyleResource> Styles,
    IReadOnlyList<string> Diagnostics);
public sealed record CssResourcesResponse(Guid DocumentId, long Revision, string? Css, PortableResourceSnapshot Resources);
public sealed record PortableResourceExportResult(string Code, CssResourcesResponse? Response = null);

public interface IDocumentResourceExporter
{
    Task<PortableResourceExportResult> ExportCssAsync(Guid documentId, long? revision, DocumentActor actor, CancellationToken ct = default);
}

// Neutral resources retain identity, source references and effective values for both themes.
// CSS is an adapter over this snapshot, never a second token/style resolver.
public sealed class DocumentResourceExporter(IDocumentAuthorization authorization,
    IDocumentStateReader reader, INodeProfile profile) : IDocumentResourceExporter
{
    public async Task<PortableResourceExportResult> ExportCssAsync(Guid documentId, long? revision,
        DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        var doc = state.Document;
        var errors = DocumentStructureValidator.Validate(doc, profile);
        if (errors.Count != 0)
        {
            var invalid = new PortableResourceSnapshot(documentId, state.Revision, [], [],
                errors.Select(e => e.Code + ": " + e.Message).ToArray());
            return new("OK", new(documentId, state.Revision, null, invalid));
        }
        var tokens = new List<PortableTokenResource>();
        foreach (var token in doc.Tokens.OrderBy(t => t.Id))
        {
            var effective = new Dictionary<TokenTheme, TokenValue>();
            foreach (var theme in Enum.GetValues<TokenTheme>())
            {
                var result = DesignTokenValidator.Resolve(doc.Tokens, token.Id, theme);
                if (result.Value is { } value) effective[theme] = value;
            }
            var refs = token.Values.Values.SelectMany(expr => expr switch
            {
                TokenAlias a => new[] { a.TokenId },
                LiteralTokenValue { Value: TypographyFieldsValue t } => new[] { t.FontFamily, t.FontSize, t.FontWeight, t.LineHeight, t.LetterSpacing }
                    .OfType<TokenAlias>().Select(x => x.TokenId),
                _ => Enumerable.Empty<Guid>()
            }).Distinct().Order().ToArray();
            tokens.Add(new(token.Id, token.Name, token.Type, token.Category, effective, refs));
        }
        var resolver = new DesignStyleResolver(doc, profile);
        var styles = doc.Styles.OrderBy(s => s.Id).Select(s =>
            new PortableStyleResource(s.Id, s.Name, s.Type, s.BasedOnStyleId, s.Fields,
                Enum.GetValues<TokenTheme>().ToDictionary(theme => theme, theme => resolver.Resolve(s.Id, theme))))
            .ToArray();
        var resources = new PortableResourceSnapshot(documentId, state.Revision, tokens, styles, []);
        var css = new CssResourceWriter(doc).Write();
        return new("OK", new(documentId, state.Revision, css, resources));
    }
}

internal sealed class CssResourceWriter(DocumentStructure document)
{
    private static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);
    private static string Key(Guid id) => "--figvam-" + id.ToString("N");
    private static string Selector(Guid id) => ".figvam-style-" + id.ToString("N");
    private static string CssColor(byte red, byte green, byte blue, byte alpha) =>
        "#" + red.ToString("X2") + green.ToString("X2") + blue.ToString("X2") + alpha.ToString("X2");
    private static string CssString(string value) => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    private static string Var(Guid id) => "var(" + Key(id) + ")";
    private readonly Dictionary<Guid, DesignToken> tokens = document.Tokens.ToDictionary(t => t.Id);
    private readonly Dictionary<Guid, DesignStyle> styles = document.Styles.ToDictionary(s => s.Id);

    public string Write()
    {
        var output = new StringBuilder("/* FigVam portable-ui/4 resources. Explicit theme selection: data-figvam-theme. */\n");
        foreach (var theme in Enum.GetValues<TokenTheme>())
        {
            output.Append(theme == TokenTheme.Light ? ":root, [data-figvam-theme=\"Light\"] {\n"
                : "[data-figvam-theme=\"Dark\"] {\n");
            foreach (var token in document.Tokens.OrderBy(t => t.Id))
            {
                var name = Key(token.Id);
                if (token.Type != TokenType.Typography)
                {
                    output.Append("  ").Append(name).Append(": ")
                        .Append(Scalar(token.Values[theme], token.Type)).Append(";\n");
                }
                else
                {
                    foreach (var (field, value) in Typography(token.Values[theme]))
                        output.Append("  ").Append(name).Append('-').Append(field).Append(": ")
                            .Append(value).Append(";\n");
                }
            }
            output.Append("}\n");
        }
        foreach (var style in document.Styles.OrderBy(s => s.Id))
        {
            output.Append(Selector(style.Id)).Append(" {\n");
            foreach (var (field, value) in StyleFields(style, []).OrderBy(p => p.Key, StringComparer.Ordinal))
            {
                if (field == "typography")
                {
                    foreach (var (name, css) in StyleTypography(value))
                        output.Append("  ").Append(name).Append(": ").Append(css).Append(";\n");
                }
                else if (StyleValue(field, value) is { } css)
                    output.Append("  ").Append(CssProperty(field)).Append(": ").Append(css).Append(";\n");
            }
            output.Append("}\n");
        }
        return output.ToString();
    }

    private Dictionary<string, NodePropertyValue> StyleFields(DesignStyle style, HashSet<Guid> visiting)
    {
        if (!visiting.Add(style.Id)) throw new InvalidOperationException("Validated styles cannot inherit cyclically.");
        var result = style.BasedOnStyleId is { } parent
            ? StyleFields(styles[parent], visiting) : new Dictionary<string, NodePropertyValue>();
        foreach (var (name, value) in style.Fields) result[name] = value;
        visiting.Remove(style.Id);
        return result;
    }

    private static string CssProperty(string name) => name switch
    {
        "textColor" => "color", "borderColor" => "border-color", "borderWidth" => "border-width",
        "cornerRadius" => "border-radius", "fontStyle" => "font-style",
        "fontFallback" => "font-family", _ => name
    };

    private static string? StyleValue(string name, NodePropertyValue value)
    {
        if (value is NodeTokenValue token) return Var(token.TokenId);
        return (name, value) switch
        {
            ("textColor" or "borderColor", NodeColorValue c) => CssColor(c.Red, c.Green, c.Blue, c.Alpha),
            ("borderWidth" or "cornerRadius", NodeNumberValue n) => Number(n.Value) + "px",
            ("fontStyle", NodeEnumValue e) => e.Value == "Italic" ? "italic" : "normal",
            ("fontFallback", NodeEnumValue e) => e.Value switch
            {
                "Serif" => "serif", "Monospace" => "monospace", _ => "sans-serif"
            },
            _ => null
        };
    }

    private IEnumerable<(string, string)> StyleTypography(NodePropertyValue value)
    {
        if (value is NodeTokenValue token)
        {
            foreach (var field in new[] { "font-family", "font-size", "font-weight", "letter-spacing", "line-height" })
                yield return (field, "var(" + Key(token.TokenId) + "-" + field + ")");
        }
        else if (value is NodeTypographyValue { Value: TypographyFieldsValue fields })
        {
            foreach (var pair in Typography(new LiteralTokenValue(fields))) yield return pair;
        }
        else if (value is NodeTypographyValue { Value: TypographyValue flat })
        {
            foreach (var pair in Typography(new LiteralTokenValue(flat))) yield return pair;
        }
    }

    private IEnumerable<(string, string)> Typography(TokenExpression expression)
    {
        if (expression is TokenAlias alias)
        {
            foreach (var field in new[] { "font-family", "font-size", "font-weight", "letter-spacing", "line-height" })
                yield return (field, "var(" + Key(alias.TokenId) + "-" + field + ")");
            yield break;
        }
        if (expression is LiteralTokenValue { Value: TypographyValue flat })
        {
            yield return ("font-family", CssString(flat.FontFamily));
            yield return ("font-size", Number(flat.FontSize) + "px");
            yield return ("font-weight", flat.FontWeight.ToString(CultureInfo.InvariantCulture));
            yield return ("letter-spacing", Number(flat.LetterSpacing) + "px");
            yield return ("line-height", Number(flat.LineHeight));
        }
        else if (expression is LiteralTokenValue { Value: TypographyFieldsValue fields })
        {
            yield return ("font-family", Scalar(fields.FontFamily, TokenType.FontFamily));
            yield return ("font-size", Scalar(fields.FontSize, TokenType.Dimension));
            yield return ("font-weight", Scalar(fields.FontWeight, TokenType.FontWeight));
            yield return ("letter-spacing", Scalar(fields.LetterSpacing ?? new LiteralTokenValue(new DimensionValue(0)), TokenType.Dimension));
            yield return ("line-height", Scalar(fields.LineHeight, TokenType.Number));
        }
    }

    private static string Scalar(TokenExpression expression, TokenType type)
    {
        if (expression is TokenAlias alias) return Var(alias.TokenId);
        if (expression is not LiteralTokenValue literal) throw new InvalidOperationException("Unsupported token expression.");
        return (type, literal.Value) switch
        {
            (TokenType.Color, ColorValue c) => CssColor(c.Red, c.Green, c.Blue, c.Alpha),
            (TokenType.Spacing, SpacingValue v) => Number(v.Value) + "px",
            (TokenType.Geometry, GeometryValue v) => Number(v.Radius) + "px",
            (TokenType.Dimension, DimensionValue v) => Number(v.Value) + "px",
            (TokenType.Number, NumberValue v) => Number(v.Value),
            (TokenType.FontFamily, FontFamilyValue v) => CssString(v.Value),
            (TokenType.FontWeight, FontWeightValue v) => v.Value.ToString(CultureInfo.InvariantCulture),
            _ => throw new InvalidOperationException("Unsupported token type.")
        };
    }
}
