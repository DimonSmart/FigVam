using System.Text;
using System.Text.Json;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

public sealed record ImportDesignTokensCommand(Guid DocumentId, Guid CommandId, long ExpectedRevision,
    string LightJson, string DarkJson, IReadOnlyDictionary<string, TokenType> DimensionTypes);
public sealed record TokenImportDiagnostic(string Code, string Path, string Message);

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(ImportDesignTokensCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, IReadOnlyList<Guid>? ids = null, IReadOnlyList<TokenImportDiagnostic>? diagnostics = null) =>
            new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, AffectedIds: ids, Diagnostics: diagnostics);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.ExpectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            if (command.ExpectedRevision != state.Revision) return new(Result("REVISION_CONFLICT"), null);
            var imported = DtcgTokenImporter.Parse(command, state.Document.Tokens);
            if (imported.Diagnostics.Count > 0) return new(Result("INVALID_TOKEN_IMPORT", diagnostics: imported.Diagnostics), null);
            var changed = state.Document with { Tokens = [.. state.Document.Tokens, .. imported.Tokens] };
            var errors = DocumentStructureValidator.Validate(changed, profile);
            if (errors.Count > 0) return new(Result("INVALID_TOKEN_IMPORT", diagnostics: errors.Select(e => new TokenImportDiagnostic(e.Code, "$", e.Message)).ToArray()), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision, imported.Tokens.Select(t => t.Id).ToArray()), next, new TokensImported(imported.Tokens));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}

internal static class DtcgTokenImporter
{
    internal sealed record Import(IReadOnlyList<DesignToken> Tokens, IReadOnlyList<TokenImportDiagnostic> Diagnostics);
    private sealed record Entry(TokenType Type, JsonElement Value);
    public static Import Parse(ImportDesignTokensCommand command, IReadOnlyList<DesignToken> existing)
    {
        var errors = new List<TokenImportDiagnostic>();
        void Error(string code, string path, string message) { if (errors.Count < 100) errors.Add(new(code, path, message)); }
        if (command.LightJson is null || command.DarkJson is null || command.DimensionTypes is null)
            return new([], [new("missing-theme-mapping", "$", "Supply LightJson, DarkJson and DimensionTypes explicitly.")]);
        if (command.LightJson.Length > 1024 * 1024 || command.DarkJson.Length > 1024 * 1024 ||
            Encoding.UTF8.GetByteCount(command.LightJson) + Encoding.UTF8.GetByteCount(command.DarkJson) > 2 * 1024 * 1024 || command.DimensionTypes.Count > 1000)
            return new([], [new("import-limit", "$", "Input exceeds 2 MiB or 1000 dimension mappings.")]);
        if (command.DimensionTypes.Keys.Any(name => !DesignTokenValidator.IsValidName(name)))
            return new([], [new("invalid-dimension-mapping", "$.dimensionTypes", "Mapping names must contain 1 to 256 printable characters.")]);
        var light = Read(command.LightJson, "Light");
        var dark = Read(command.DarkJson, "Dark");
        if (errors.Count > 0) return new([], errors);
        if (light.Count == 0 || light.Count + existing.Count > 1000)
            Error("import-limit", "$", "Import must contain tokens and the resulting document may contain at most 1000 tokens.");
        foreach (var name in light.Keys.Union(dark.Keys, StringComparer.Ordinal))
        {
            if (!light.TryGetValue(name, out var l) || !dark.TryGetValue(name, out var d))
                Error("incomplete-theme", name, "The token must be present in both explicitly supplied themes.");
            else if (l.Type != d.Type) Error("type-mismatch", name, "Both themes must declare the same FigVam type.");
            if (existing.Any(t => t.Name == name)) Error("name-conflict", name, "An existing token already uses this name; import only adds new tokens.");
        }
        foreach (var name in command.DimensionTypes.Keys)
            if (!light.TryGetValue(name, out var entry) || entry.Type == TokenType.Color)
                Error("invalid-dimension-mapping", name, "Dimension mapping must name an imported dimension token.");
        if (errors.Count > 0) return new([], errors);
        var ids = light.Keys.ToDictionary(n => n, _ => Guid.NewGuid(), StringComparer.Ordinal);
        var tokens = light.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => new DesignToken(ids[e.Key], e.Key, e.Value.Type,
            new Dictionary<TokenTheme, TokenExpression> { [TokenTheme.Light] = Expression(e.Key, e.Value, "Light"), [TokenTheme.Dark] = Expression(e.Key, dark[e.Key], "Dark") })).ToArray();
        if (errors.Count == 0)
            foreach (var diagnostic in DesignTokenValidator.Validate(tokens))
                Error(diagnostic.Code, $"{diagnostic.Theme}.{tokens.First(t => t.Id == diagnostic.TokenId).Name}", diagnostic.Message);
        return new(errors.Count == 0 ? tokens : [], errors);

        Dictionary<string, Entry> Read(string json, string theme)
        {
            var entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
            try
            {
                using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
                if (document.RootElement.ValueKind != JsonValueKind.Object) { Error("invalid-json", theme, "DTCG input must be a flat token object."); return entries; }
                var count = 0;
                foreach (var property in document.RootElement.EnumerateObject())
                {
                    if (++count > 1000) { Error("import-limit", theme, "At most 1000 tokens per theme."); break; }
                    var name = property.Name; var path = name.Length <= 256 ? theme + "." + name : theme;
                    if (!DesignTokenValidator.IsValidName(name) || name.StartsWith('$') || name.IndexOfAny(['{', '}', '.']) >= 0)
                    { Error("unsupported-name", path, "Token names must be printable, at most 256 characters, and cannot start with $ or contain braces or periods."); continue; }
                    if (entries.ContainsKey(name)) { Error("duplicate-name", path, "Duplicate token name."); continue; }
                    var token = property.Value;
                    if (!Fields(token, ["$type", "$value"]) || !token.TryGetProperty("$type", out var type) || type.ValueKind != JsonValueKind.String || !token.TryGetProperty("$value", out var value))
                    { Error("unsupported-construct", path, "Only flat tokens with explicit $type and $value are supported; groups, extensions and metadata are rejected."); continue; }
                    TokenType figType;
                    switch (type.GetString())
                    {
                        case "color": figType = TokenType.Color; break;
                        case "dimension":
                            if (!command.DimensionTypes.TryGetValue(name, out figType) || figType is not (TokenType.Spacing or TokenType.Geometry))
                            { Error("dimension-type-required", path, "Explicitly map dimension to Spacing or Geometry."); continue; }
                            break;
                        default: Error("unsupported-type", path, "Only color and dimension are supported. Typography cannot be mapped without ambiguous semantics."); continue;
                    }
                    entries.Add(name, new(figType, value.Clone()));
                }
            }
            catch (JsonException) { Error("invalid-json", theme, "Malformed JSON or input nesting exceeds 8."); }
            return entries;
        }
        TokenExpression Expression(string name, Entry entry, string theme)
        {
            var value = entry.Value; var path = theme + "." + name + ".$value";
            if (value.ValueKind == JsonValueKind.String)
            {
                var alias = value.GetString()!;
                if (alias.Length >= 3 && alias[0] == '{' && alias[^1] == '}' && ids.TryGetValue(alias[1..^1], out var target)) return new TokenAlias(target);
                Error("missing-reference", path, "Alias must reference an imported flat token by {name}.");
            }
            else if (entry.Type == TokenType.Color && Fields(value, ["colorSpace", "components", "alpha"]) &&
                value.TryGetProperty("colorSpace", out var space) && space.ValueKind == JsonValueKind.String && space.GetString() == "srgb" &&
                value.TryGetProperty("components", out var components) && components.ValueKind == JsonValueKind.Array && components.GetArrayLength() == 3)
            {
                var channels = components.EnumerateArray().ToArray();
                var alpha = value.TryGetProperty("alpha", out var a) ? a : default;
                if (channels.All(Channel) && (alpha.ValueKind == JsonValueKind.Undefined || Channel(alpha)))
                    return new LiteralTokenValue(new ColorValue(Byte(channels[0]), Byte(channels[1]), Byte(channels[2]), alpha.ValueKind == JsonValueKind.Undefined ? (byte)255 : Byte(alpha)));
                Error("unsupported-color", path, "sRGB components and alpha must be exactly representable by FigVam 8-bit channels.");
            }
            else if (entry.Type is TokenType.Spacing or TokenType.Geometry && Fields(value, ["value", "unit"]) &&
                value.TryGetProperty("unit", out var unit) && unit.ValueKind == JsonValueKind.String && unit.GetString() == "px" &&
                value.TryGetProperty("value", out var number) && number.ValueKind == JsonValueKind.Number && number.TryGetDouble(out var n) && double.IsFinite(n))
                return new LiteralTokenValue(entry.Type == TokenType.Spacing ? new SpacingValue(n) : new GeometryValue(n));
            else Error("unsupported-value", path, "Expected a whole-token alias, sRGB color or finite px dimension; component references and other representations are unsupported.");
            return new LiteralTokenValue(new SpacingValue(0));
        }
    }
    private static bool Fields(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) return false;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Add(property.Name) || !allowed.Contains(property.Name, StringComparer.Ordinal)) return false;
        return true;
    }
    private static bool Channel(JsonElement e) => e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out var n) && double.IsFinite(n) && n >= 0 && n <= 1 && Math.Abs(n * 255 - Math.Round(n * 255)) < 1e-9;
    private static byte Byte(JsonElement e) => (byte)Math.Round(e.GetDouble() * 255);
}
