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
        // There is no viewer export policy yet; only owner/editor permissions permit export.
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (!Enum.IsDefined(theme)) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        var tokens = state.Document.Tokens.OrderBy(t => t.Name, StringComparer.Ordinal).ThenBy(t => t.Id).ToArray();
        if (tokens.Length > 1000) return new("EXPORT_TOO_LARGE");
        var diagnostics = new List<TokenExportDiagnostic>();
        foreach (var error in DesignTokenValidator.Validate(tokens).Where(e => e.Theme is null || e.Theme == theme))
            diagnostics.Add(new(error.Code, error.TokenId, error.Message));
        foreach (var token in tokens)
        {
            if (token.Name.StartsWith('$') || token.Name.IndexOfAny(['{', '}', '.']) >= 0)
                diagnostics.Add(new("unsupported-name", token.Id, "DTCG names cannot start with $ or contain braces or periods."));
            if (token.Type == TokenType.Typography)
                diagnostics.Add(new("unsupported-typography", token.Id, "DTCG typography requires letter spacing, which the document does not provide, and the document does not define whether line height is a multiplier or a length."));
            else if (token.Type is TokenType.Dimension or TokenType.Number or TokenType.FontFamily or TokenType.FontWeight)
                diagnostics.Add(new("unsupported-token-type", token.Id, $"DTCG export does not yet support {token.Type} tokens."));
        }
        foreach (var group in tokens.GroupBy(t => t.Name, StringComparer.Ordinal).Where(g => g.Count() > 1))
            foreach (var token in group) diagnostics.Add(new("duplicate-name", token.Id, "DTCG token names must be unique within the exported group."));
        if (diagnostics.Count > 0)
            return new("OK", new(documentId, state.Revision, theme, null, diagnostics.OrderBy(d => d.TokenId).ThenBy(d => d.Code, StringComparer.Ordinal).ToArray()));
        var byId = tokens.ToDictionary(t => t.Id);
        var result = new JsonObject();
        foreach (var token in tokens)
        {
            JsonNode value = token.Values[theme] switch
            {
                TokenAlias alias => JsonValue.Create("{" + byId[alias.TokenId].Name + "}")!,
                LiteralTokenValue { Value: ColorValue c } => new JsonObject { ["colorSpace"] = "srgb", ["components"] = new JsonArray(c.Red / 255d, c.Green / 255d, c.Blue / 255d), ["alpha"] = c.Alpha / 255d },
                LiteralTokenValue { Value: SpacingValue s } => Dimension(s.Value),
                LiteralTokenValue { Value: GeometryValue g } => Dimension(g.Radius),
                _ => throw new InvalidOperationException("Validated token has no supported export mapping.")
            };
            result.Add(token.Name, new JsonObject { ["$type"] = token.Type == TokenType.Color ? "color" : "dimension", ["$value"] = value });
        }
        if (JsonSerializer.SerializeToUtf8Bytes(result).Length > 1024 * 1024) return new("EXPORT_TOO_LARGE");
        return new("OK", new(documentId, state.Revision, theme, result, []));
    }
    private static JsonObject Dimension(double value) => new() { ["value"] = value, ["unit"] = "px" };
}

