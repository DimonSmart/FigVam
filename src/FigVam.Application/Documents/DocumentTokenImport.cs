using System.Text;
using System.Text.Json;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

public sealed record ImportDesignTokensCommand(Guid DocumentId, Guid CommandId, long ExpectedRevision,
    string LightJson, string DarkJson, IReadOnlyDictionary<string, TokenType> DimensionTypes,
    IReadOnlyDictionary<string, TokenCategory>? DimensionCategories = null,
    IReadOnlyDictionary<string, TokenCategory>? NumberCategories = null);
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
    private sealed record Entry(TokenType Type, TokenCategory? Category, Guid? Id, JsonElement Value);

    public static Import Parse(ImportDesignTokensCommand command, IReadOnlyList<DesignToken> existing)
    {
        var errors = new List<TokenImportDiagnostic>();
        void Error(string code, string path, string message)
        {
            if (errors.Count < 100) errors.Add(new(code, path.Length <= 300 ? path : path[..300], message));
        }

        if (command.LightJson is null || command.DarkJson is null || command.DimensionTypes is null)
            return new([], [new("missing-theme-mapping", "$", "LightJson, DarkJson and DimensionTypes are required.")]);
        if (command.LightJson.Length > 1024 * 1024 || command.DarkJson.Length > 1024 * 1024 ||
            Encoding.UTF8.GetByteCount(command.LightJson) + Encoding.UTF8.GetByteCount(command.DarkJson) > 2 * 1024 * 1024 ||
            command.DimensionTypes.Count > 1000 || command.DimensionCategories?.Count > 1000 || command.NumberCategories?.Count > 1000)
            return new([], [new("import-limit", "$", "DTCG input exceeds size or mapping limits.")]);
        if (command.DimensionTypes.Keys.Concat(command.DimensionCategories?.Keys ?? []).Concat(command.NumberCategories?.Keys ?? [])
            .Any(name => !DesignTokenValidator.IsValidName(name)))
            return new([], [new("invalid-dimension-mapping", "$.mappings", "Invalid token mapping path.")]);

        var light = Read(command.LightJson, "Light");
        var dark = Read(command.DarkJson, "Dark");
        if (errors.Count != 0) return new([], errors);
        if (light.Count == 0 || light.Count + existing.Count > 1000)
            Error("import-limit", "$", "At least one token and at most 1000 total tokens are supported.");

        foreach (var name in light.Keys.Union(dark.Keys, StringComparer.Ordinal))
        {
            if (!light.TryGetValue(name, out var l) || !dark.TryGetValue(name, out var d))
            {
                Error("incomplete-theme", name, "Both Light and Dark must contain the same token paths.");
                continue;
            }
            if (l.Type != d.Type || l.Category != d.Category)
                Error("type-mismatch", name, "Both themes must use the same type and category.");
            if (l.Id != d.Id)
                Error("identity-conflict", name, "Both themes must agree on org.figvam identity.");
            if (existing.Any(t => t.Name == name))
                Error("name-conflict", name, "An existing token already has this path.");
        }
        foreach (var name in command.DimensionTypes.Keys.Concat(command.DimensionCategories?.Keys ?? []).Concat(command.NumberCategories?.Keys ?? []))
            if (!light.ContainsKey(name))
                Error("invalid-dimension-mapping", name, "Mapping must name a token being imported.");
        var existingIds = existing.Select(t => t.Id).ToHashSet();
        var incomingIds = new HashSet<Guid>();
        foreach (var (name, entry) in light)
            if (entry.Id is { } id && (!incomingIds.Add(id) || existingIds.Contains(id)))
                Error("id-conflict", name, "Token ID is duplicated or already exists in the document.");
        if (errors.Count != 0) return new([], errors);

        var ids = light.ToDictionary(e => e.Key, e => e.Value.Id ?? Guid.NewGuid(), StringComparer.Ordinal);
        var result = new List<DesignToken>();
        foreach (var (name, entry) in light.OrderBy(e => e.Key, StringComparer.Ordinal))
        {
            var values = new Dictionary<TokenTheme, TokenExpression>
            {
                [TokenTheme.Light] = Expression(entry.Value, entry.Type, entry.Category, "Light." + name + ".$value"),
                [TokenTheme.Dark] = Expression(dark[name].Value, entry.Type, entry.Category, "Dark." + name + ".$value")
            };
            result.Add(new(ids[name], name, entry.Type, values, entry.Category));
        }
        if (errors.Count == 0)
        {
            foreach (var diagnostic in DesignTokenValidator.Validate(result))
                Error(diagnostic.Code, diagnostic.Theme + "." + (result.FirstOrDefault(t => t.Id == diagnostic.TokenId)?.Name ?? "$"), diagnostic.Message);
            if (errors.Count == 0)
                foreach (var token in result)
                foreach (var theme in Enum.GetValues<TokenTheme>())
                {
                    var resolution = DesignTokenValidator.Resolve(result, token.Id, theme);
                    foreach (var diagnostic in resolution.Diagnostics)
                    {
                        Error(diagnostic.Code, theme + "." + token.Name + (diagnostic.Field is null ? "" : "." + diagnostic.Field), diagnostic.Message);
                        if (errors.Count != 0) break;
                    }
                    if (errors.Count != 0) break;
                }
        }
        return new(errors.Count == 0 ? result : [], errors);

        Dictionary<string, Entry> Read(string json, string theme)
        {
            var entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
            try
            {
                using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 32 });
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    Error("invalid-json", theme, "Root of a DTCG file must be an object.");
                    return entries;
                }
                Group(document.RootElement, "", null, 0);
            }
            catch (JsonException) { Error("invalid-json", theme, "Malformed JSON or nesting exceeds 32 levels."); }
            return entries;

            void Group(JsonElement group, string prefix, string? inherited, int depth)
            {
                if (depth > 28) { Error("import-limit", theme + "." + prefix, "Group depth exceeds 28."); return; }
                if (HasDuplicates(group)) { Error("duplicate-name", theme + "." + prefix, "Duplicate JSON object key."); return; }
                if (group.TryGetProperty("$extends", out _)) { Error("unsupported-construct", theme + "." + prefix, "$extends is not supported."); return; }
                string? type = inherited;
                if (group.TryGetProperty("$type", out var localType))
                {
                    if (localType.ValueKind != JsonValueKind.String) { Error("unsupported-type", theme + "." + prefix, "$type must be a string."); return; }
                    type = localType.GetString();
                }
                foreach (var property in group.EnumerateObject())
                {
                    if (property.Name == "$type" || property.Name == "$description") continue;
                    if (property.Name.StartsWith('$')) { Error("unsupported-construct", theme + "." + prefix, "Unsupported group metadata."); continue; }
                    if (!ValidSegment(property.Name))
                    { Error("unsupported-name", theme + "." + prefix, "Invalid DTCG path segment."); continue; }
                    var name = prefix.Length == 0 ? property.Name : prefix + "." + property.Name;
                    if (!DesignTokenValidator.IsValidName(name)) { Error("unsupported-name", theme + "." + name, "Token name is too long."); continue; }
                    if (property.Value.ValueKind != JsonValueKind.Object)
                    { Error("unsupported-construct", theme + "." + name, "Expected a token or nested group object."); continue; }
                    if (property.Value.TryGetProperty("$value", out var value))
                    {
                        if (!Fields(property.Value, ["$type", "$value", "$description", "$extensions"]))
                        { Error("unsupported-construct", theme + "." + name, "Token contains unsupported or duplicate metadata."); continue; }
                        if (entries.Count >= 1000) { Error("import-limit", theme, "At most 1000 tokens per theme."); return; }
                        var declared = property.Value.TryGetProperty("$type", out var ownType) ? ownType : default;
                        var effective = declared.ValueKind == JsonValueKind.String ? declared.GetString() : type;
                        if (declared.ValueKind != JsonValueKind.Undefined && declared.ValueKind != JsonValueKind.String)
                        { Error("unsupported-type", theme + "." + name, "$type must be a string."); continue; }
                        var figType = effective switch
                        {
                            "color" => TokenType.Color,
                            "dimension" => TokenType.Dimension,
                            "number" => TokenType.Number,
                            "fontFamily" => TokenType.FontFamily,
                            "fontWeight" => TokenType.FontWeight,
                            "typography" => TokenType.Typography,
                             "shadow" => TokenType.Shadow,
                            _ => (TokenType)(-1)
                        };
                        if (!Enum.IsDefined(figType)) { Error("unsupported-type", theme + "." + name, "Unsupported or absent DTCG type."); continue; }
                        Guid? id = null;
                        TokenCategory? category = null;
                        var extensionTypeSpecified = false;
                        if (property.Value.TryGetProperty("$extensions", out var extensions))
                        {
                            if (!Fields(extensions, ["org.figvam"]) || !extensions.TryGetProperty("org.figvam", out var meta) ||
                                !Fields(meta, ["id", "type", "category"]))
                            { Error("unsupported-construct", theme + "." + name, "Only org.figvam identity/type/category extensions are supported."); continue; }
                            if (meta.TryGetProperty("id", out var valueId))
                            {
                                if (valueId.ValueKind != JsonValueKind.String || !Guid.TryParse(valueId.GetString(), out var parsed) || parsed == Guid.Empty)
                                { Error("invalid-id", theme + "." + name, "Invalid org.figvam ID."); continue; }
                                id = parsed;
                            }
                            if (meta.TryGetProperty("category", out var valueCategory))
                            {
                                if (valueCategory.ValueKind != JsonValueKind.String || !Enum.TryParse<TokenCategory>(valueCategory.GetString(), false, out var parsed) ||
                                    !Enum.IsDefined(parsed))
                                { Error("invalid-category", theme + "." + name, "Invalid org.figvam category."); continue; }
                                category = parsed;
                            }
                            if (meta.TryGetProperty("type", out var valueType))
                            {
                                if (valueType.ValueKind != JsonValueKind.String || !Enum.TryParse<TokenType>(valueType.GetString(), false, out var internalType) ||
                                    !Enum.IsDefined(internalType) ||
                                    (figType == TokenType.Dimension ? internalType is not (TokenType.Dimension or TokenType.Spacing or TokenType.Geometry) : internalType != figType))
                                { Error("type-mismatch", theme + "." + name, "Extension type is incompatible with DTCG type."); continue; }
                                figType = internalType;
                                extensionTypeSpecified = true;
                            }
                        }
                        // Existing explicit legacy mappings remain valid for old files without org.figvam metadata.
                        if (figType == TokenType.Dimension && command.DimensionTypes.TryGetValue(name, out var legacy) &&
                            legacy is TokenType.Spacing or TokenType.Geometry)
                        {
                            if (extensionTypeSpecified)
                            { Error("invalid-dimension-mapping", name, "Mapping conflicts with an explicitly declared FigVam type."); continue; }
                            figType = legacy;
                        }
                        if (figType == TokenType.Dimension)
                        {
                            if (command.DimensionTypes.TryGetValue(name, out var mapped) && mapped != TokenType.Dimension)
                            { Error("invalid-dimension-mapping", name, "Dimension mapping conflicts with extension type."); continue; }
                            if (command.DimensionCategories?.TryGetValue(name, out var mappedCategory) == true)
                            {
                                if (category is { } declaredCategory && declaredCategory != mappedCategory)
                                { Error("invalid-dimension-mapping", name, "Dimension mapping conflicts with the declared category."); continue; }
                                category = mappedCategory;
                            }
                            if (category is null) { Error("dimension-type-required", theme + "." + name, "Dimension category must be supplied in org.figvam or dimensionCategories."); continue; }
                        }
                        else if (figType is TokenType.Spacing or TokenType.Geometry)
                        {
                            if (category is not null) { Error("invalid-category", theme + "." + name, "Legacy dimensions cannot have a semantic category."); continue; }
                            if (command.DimensionTypes.TryGetValue(name, out var mapped) && mapped != figType)
                            { Error("invalid-dimension-mapping", name, "Dimension mapping conflicts with extension type."); continue; }
                        }
                        else if (figType == TokenType.Number)
                        {
                            if (command.NumberCategories?.TryGetValue(name, out var mappedCategory) == true)
                            {
                                if (category is { } declaredCategory && declaredCategory != mappedCategory)
                                { Error("invalid-number-mapping", name, "Number mapping conflicts with the declared category."); continue; }
                                category = mappedCategory;
                            }
                            if (category is null) { Error("number-category-required", theme + "." + name, "Number category must be supplied in org.figvam or numberCategories."); continue; }
                        }
                        else if (category is not null)
                        { Error("invalid-category", theme + "." + name, "This token type cannot have a semantic category."); continue; }
                        if (!DesignTokenValidator.ValidCategory(figType, category))
                        { Error("invalid-category", theme + "." + name, "Semantic category is incompatible with token type."); continue; }
                        entries.Add(name, new(figType, category, id, value.Clone()));
                    }
                    else
                    {
                        if (property.Value.TryGetProperty("$extensions", out _) || property.Value.TryGetProperty("$ref", out _))
                        { Error("unsupported-construct", theme + "." + name, "Group extensions and $ref are unsupported."); continue; }
                        Group(property.Value, name, type, depth + 1);
                    }
                }
            }
        }

        TokenExpression Expression(JsonElement value, TokenType type, TokenCategory? category, string path)
        {
            if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("$ref", out _))
            { Error("UNSUPPORTED_REFERENCE", path, "JSON Pointer $ref is not available for this profile."); return Invalid(); }
            if (value.ValueKind == JsonValueKind.String)
            {
                var source = value.GetString()!;
                if (source.Length >= 3 && source[0] == '{' && source[^1] == '}')
                {
                    var targetName = source[1..^1];
                    if (ids.TryGetValue(targetName, out var reference)) return new TokenAlias(reference);
                    Error("missing-reference", path, "Alias points outside the imported DTCG files.");
                    return Invalid();
                }
                if (type == TokenType.FontFamily) return new LiteralTokenValue(new FontFamilyValue(source));
                Error("unsupported-value", path, "String is neither a valid reference nor a fontFamily.");
                return Invalid();
            }
            switch (type)
            {
                case TokenType.Shadow:
                    if (Fields(value, ["offsetX", "offsetY", "blur", "spread", "color"]) &&
                        new[] { "offsetX", "offsetY", "blur", "spread", "color" }.All(field => value.TryGetProperty(field, out _)) &&
                        Expression(value.GetProperty("offsetX"), TokenType.Dimension, null, path + ".offsetX") is LiteralTokenValue { Value: DimensionValue x } &&
                        Expression(value.GetProperty("offsetY"), TokenType.Dimension, null, path + ".offsetY") is LiteralTokenValue { Value: DimensionValue y } &&
                        Expression(value.GetProperty("blur"), TokenType.Dimension, null, path + ".blur") is LiteralTokenValue { Value: DimensionValue blur } &&
                        Expression(value.GetProperty("spread"), TokenType.Dimension, null, path + ".spread") is LiteralTokenValue { Value: DimensionValue spread })
                    {
                        var color = Expression(value.GetProperty("color"), TokenType.Color, null, path + ".color");
                        if (color is LiteralTokenValue { Value: ColorValue c })
                            return new LiteralTokenValue(new ShadowValue(x.Value, y.Value, blur.Value, spread.Value,
                                new(c.Red, c.Green, c.Blue, c.Alpha)));
                        if (color is TokenAlias)
                            return new LiteralTokenValue(new ShadowFieldsValue(x.Value, y.Value, blur.Value, spread.Value, color));
                    }
                    Error("unsupported-value", path, "Shadow must contain four literal pixel dimensions and an sRGB color or Color token reference.");
                    return Invalid();
                case TokenType.Typography:
                    if (!Fields(value, ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight"]) ||
                        new[] { "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight" }.Any(field => !value.TryGetProperty(field, out _)))
                    {
                        Error("unsupported-value", path, "Typography must contain all five DTCG fields.");
                        return Invalid();
                    }
                    return new LiteralTokenValue(new TypographyFieldsValue(
                        Expression(value.GetProperty("fontFamily"), TokenType.FontFamily, null, path + ".fontFamily"),
                        Expression(value.GetProperty("fontSize"), TokenType.Dimension, TokenCategory.FontSize, path + ".fontSize"),
                        Expression(value.GetProperty("fontWeight"), TokenType.FontWeight, null, path + ".fontWeight"),
                        Expression(value.GetProperty("lineHeight"), TokenType.Number, TokenCategory.LineHeight, path + ".lineHeight"),
                        Expression(value.GetProperty("letterSpacing"), TokenType.Dimension, TokenCategory.LetterSpacing, path + ".letterSpacing")));
                case TokenType.Color:
                    if (Fields(value, ["colorSpace", "components", "alpha"]) &&
                        value.TryGetProperty("colorSpace", out var space) && space.ValueKind == JsonValueKind.String && space.GetString() == "srgb" &&
                        value.TryGetProperty("components", out var components) && components.ValueKind == JsonValueKind.Array && components.GetArrayLength() == 3)
                    {
                        var channels = components.EnumerateArray().ToArray();
                        var alpha = value.TryGetProperty("alpha", out var a) ? a : default;
                        if (channels.All(Channel) && (alpha.ValueKind == JsonValueKind.Undefined || Channel(alpha)))
                            return new LiteralTokenValue(new ColorValue(Byte(channels[0]), Byte(channels[1]), Byte(channels[2]),
                                alpha.ValueKind == JsonValueKind.Undefined ? (byte)255 : Byte(alpha)));
                    }
                    Error("unsupported-color", path, "Only exactly representable 8-bit sRGB colors are supported.");
                    return Invalid();
                case TokenType.Spacing or TokenType.Geometry or TokenType.Dimension:
                    if (Fields(value, ["value", "unit"]) && value.TryGetProperty("unit", out var unit) &&
                        unit.ValueKind == JsonValueKind.String && unit.GetString() == "px" &&
                        value.TryGetProperty("value", out var amount) && amount.ValueKind == JsonValueKind.Number &&
                        amount.TryGetDouble(out var d) && double.IsFinite(d))
                        return new LiteralTokenValue(type switch
                        {
                            TokenType.Spacing => new SpacingValue(d),
                            TokenType.Geometry => new GeometryValue(d),
                            _ => new DimensionValue(d)
                        });
                    Error("unsupported-value", path, "Dimension must have finite px value; unsupported unit or shape.");
                    return Invalid();
                case TokenType.Number:
                    if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var n) && double.IsFinite(n))
                        return new LiteralTokenValue(new NumberValue(n));
                    Error("unsupported-value", path, "Number must be a finite JSON number.");
                    return Invalid();
                case TokenType.FontWeight:
                    if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var w))
                        return new LiteralTokenValue(new FontWeightValue(w));
                    Error("unsupported-value", path, "FontWeight must be an integer.");
                    return Invalid();
                default:
                    Error("unsupported-value", path, "Unsupported DTCG literal.");
                    return Invalid();
            }
        }
        static TokenExpression Invalid() => new LiteralTokenValue(new NumberValue(0));
    }

    private static bool ValidSegment(string name) =>
        name.Length is > 0 and <= 256 && !name.StartsWith('$') && !name.Any(c => char.IsControl(c) || c is '{' or '}' or '.');

    private static bool HasDuplicates(JsonElement value)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        return value.EnumerateObject().Any(p => !names.Add(p.Name));
    }

    private static bool Fields(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) return false;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject())
            if (!names.Add(p.Name) || !allowed.Contains(p.Name, StringComparer.Ordinal)) return false;
        return true;
    }

    private static bool Channel(JsonElement e) =>
        e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out var n) && double.IsFinite(n) && n >= 0 && n <= 1 &&
        Math.Abs(n * 255 - Math.Round(n * 255)) < 1e-9;
    private static byte Byte(JsonElement e) => (byte)Math.Round(e.GetDouble() * 255);
}
