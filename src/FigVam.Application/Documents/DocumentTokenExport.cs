using System.Text.Json;
using System.Text.Json.Nodes;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

public sealed record TokenExportDiagnostic(string Code, Guid TokenId, string Message);
public sealed record TokenExportResponse(Guid DocumentId, long Revision, TokenTheme Theme, JsonObject? Tokens, IReadOnlyList<TokenExportDiagnostic> Diagnostics);
public sealed record TokenExportResult(string Code, TokenExportResponse? Response = null);

public interface IDocumentTokenExporter
{
    Task<TokenExportResult> ExportAsync(Guid documentId, long? revision, TokenTheme theme, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentTokenExporter(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentTokenExporter
{
    public async Task<TokenExportResult> ExportAsync(Guid documentId, long? revision, TokenTheme theme, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (!Enum.IsDefined(theme)) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        var tokens = state.Document.Tokens.OrderBy(t => t.Name, StringComparer.Ordinal).ThenBy(t => t.Id).ToArray();
        if (tokens.Length > 1000) return new("EXPORT_TOO_LARGE");
        var errors = new List<TokenExportDiagnostic>();
        void Error(string code, DesignToken token, string message) => errors.Add(new(code, token.Id, message));
        foreach (var diagnostic in DesignTokenValidator.Validate(tokens))
            errors.Add(new(diagnostic.Code, diagnostic.TokenId, diagnostic.Message));
        foreach (var pair in tokens.GroupBy(t => t.Name, StringComparer.Ordinal).Where(g => g.Count() > 1))
            foreach (var token in pair) Error("duplicate-name", token, "Multiple tokens share this name.");
        var byId = tokens.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var root = new JsonObject();
        foreach (var token in tokens)
        {
            var parts = token.Name.Split('.');
            if (!parts.All(ValidSegment))
            {
                Error("unsupported-name", token, "Token name cannot be represented by DTCG path segments.");
                continue;
            }
            var group = root;
            var collision = false;
            foreach (var part in parts[..^1])
            {
                if (group[part] is null) group[part] = new JsonObject();
                if (group[part] is not JsonObject child || child.ContainsKey("$value"))
                {
                    Error("name-conflict", token, "Token name conflicts with another token or group.");
                    collision = true;
                    break;
                }
                group = child;
            }
            if (collision) continue;
            if (group.ContainsKey(parts[^1]))
            {
                Error("name-conflict", token, "Token name conflicts with another token or group.");
                continue;
            }
            var expression = token.Values?.GetValueOrDefault(theme);
            if (expression is null) { Error("incomplete-theme", token, "Theme is missing."); continue; }
            try
            {
                var value = Expression(expression, token.Type, byId);
                var body = new JsonObject
                {
                    ["$type"] = token.Type switch
                    {
                        TokenType.Color => "color",
                        TokenType.Spacing or TokenType.Geometry or TokenType.Dimension => "dimension",
                        TokenType.Number => "number",
                        TokenType.FontFamily => "fontFamily",
                        TokenType.FontWeight => "fontWeight",
                        TokenType.Typography => "typography",
                         TokenType.Shadow => "shadow",
                        _ => throw new ArgumentException("Unsupported token type.")
                    },
                    ["$value"] = value
                };
                var metadata = new JsonObject { ["id"] = token.Id.ToString("D"), ["type"] = token.Type.ToString() };
                if (token.Category is { } category) metadata["category"] = category.ToString();
                body["$extensions"] = new JsonObject { ["org.figvam"] = metadata };
                group[parts[^1]] = body;
            }
            catch (ArgumentException ex) { Error("unsupported-value", token, ex.Message); }
        }
        if (errors.Count != 0)
            return new("OK", new(documentId, state.Revision, theme, null,
                errors.OrderBy(e => e.TokenId).ThenBy(e => e.Code, StringComparer.Ordinal).ToArray()));
        if (JsonSerializer.SerializeToUtf8Bytes(root).Length > 1024 * 1024) return new("EXPORT_TOO_LARGE");
        return new("OK", new(documentId, state.Revision, theme, root, []));
    }

    private static bool ValidSegment(string segment) =>
        segment.Length is > 0 and <= 256 && !segment.StartsWith('$') &&
        !segment.Any(c => char.IsControl(c) || c is '{' or '}' or '.');

    private static JsonNode Expression(TokenExpression expression, TokenType type, IReadOnlyDictionary<Guid, DesignToken> byId)
    {
        if (expression is TokenAlias alias)
        {
            if (!byId.TryGetValue(alias.TokenId, out var target))
                throw new ArgumentException("Alias refers to a missing token.");
            return JsonValue.Create("{" + target.Name + "}")!;
        }
        if (expression is not LiteralTokenValue literal)
            throw new ArgumentException("Unsupported token expression.");
        return Value(literal.Value, type, byId);
    }

    private static JsonNode Value(TokenValue value, TokenType type, IReadOnlyDictionary<Guid, DesignToken> byId) => (type, value) switch
    {
        (TokenType.Color, ColorValue c) => new JsonObject
        {
            ["colorSpace"] = "srgb", ["components"] = new JsonArray(c.Red / 255d, c.Green / 255d, c.Blue / 255d),
            ["alpha"] = c.Alpha / 255d
        },
        (TokenType.Spacing, SpacingValue v) => Dimension(v.Value),
        (TokenType.Geometry, GeometryValue v) => Dimension(v.Radius),
        (TokenType.Dimension, DimensionValue v) => Dimension(v.Value),
        (TokenType.Number, NumberValue v) => JsonValue.Create(v.Value)!,
        (TokenType.FontFamily, FontFamilyValue v) => JsonValue.Create(v.Value)!,
        (TokenType.FontWeight, FontWeightValue v) => JsonValue.Create(v.Value)!,
        (TokenType.Shadow, ShadowValue v) => new JsonObject
        {
            ["offsetX"] = Dimension(v.OffsetX), ["offsetY"] = Dimension(v.OffsetY),
            ["blur"] = Dimension(v.BlurRadius), ["spread"] = Dimension(v.SpreadRadius),
            ["color"] = Value(new ColorValue(v.Color.Red, v.Color.Green, v.Color.Blue, v.Color.Alpha), TokenType.Color, byId)
        },
        (TokenType.Typography, TypographyValue v) => new JsonObject
        {
            ["fontFamily"] = v.FontFamily, ["fontSize"] = Dimension(v.FontSize),
            ["fontWeight"] = v.FontWeight, ["letterSpacing"] = Dimension(v.LetterSpacing),
            ["lineHeight"] = v.LineHeight
        },
        (TokenType.Typography, TypographyFieldsValue v) => new JsonObject
        {
            ["fontFamily"] = Expression(v.FontFamily, TokenType.FontFamily, byId),
            ["fontSize"] = Expression(v.FontSize, TokenType.Dimension, byId),
            ["fontWeight"] = Expression(v.FontWeight, TokenType.FontWeight, byId),
            ["letterSpacing"] = Expression(v.LetterSpacing ?? new LiteralTokenValue(new DimensionValue(0)), TokenType.Dimension, byId),
            ["lineHeight"] = Expression(v.LineHeight, TokenType.Number, byId)
        },
        _ => throw new ArgumentException("Literal cannot be represented as the selected DTCG type.")
    };

    private static JsonObject Dimension(double value) => new() { ["value"] = value, ["unit"] = "px" };
}
