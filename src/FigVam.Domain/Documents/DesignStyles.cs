using FigVam.Domain.Tokens;

namespace FigVam.Domain.Documents;

public enum DesignStyleType { TextStyle, BorderStyle }

// Null or missing fields are not defaults: each style contains only explicit overrides.
public sealed record DesignStyle(Guid Id, string Name, DesignStyleType Type,
    IReadOnlyDictionary<string, NodePropertyValue> Fields, Guid? BasedOnStyleId = null);

public sealed class DesignStyleException(string code, Guid styleId, string field, Guid? referenceId, string message)
    : Exception(message)
{
    public string Code { get; } = code;
    public Guid StyleId { get; } = styleId;
    public string Field { get; } = field;
    public Guid? ReferenceId { get; } = referenceId;
}

public static class DesignStyleValidator
{
    private static readonly IReadOnlySet<string> TextFields =
        new HashSet<string>(["typography", "textColor", "fontStyle", "fontFallback"], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> BorderFields =
        new HashSet<string>(["borderColor", "borderWidth", "cornerRadius"], StringComparer.Ordinal);

    public static IReadOnlyList<StructureError> Validate(DocumentStructure document, INodeProfile profile)
    {
        if (document.Styles is null)
            return [new("invalid-styles", document.Id, null, "Styles collection is required.")];
        var errors = new List<StructureError>();
        if (document.Styles.Count > 2000)
            errors.Add(new("style-limit", document.Id, null, "At most 2000 design styles are supported."));
        var ids = new HashSet<Guid>();
        foreach (var style in document.Styles)
        {
            if (style is null)
            {
                errors.Add(new("invalid-style", document.Id, null, "Design style cannot be null."));
                continue;
            }
            if (style.Id == Guid.Empty || !ids.Add(style.Id))
                errors.Add(new("duplicate-id", style.Id, null, "Design style ID must be unique and nonempty."));
            if (!Enum.IsDefined(style.Type))
                errors.Add(new("invalid-style-type", style.Id, null, "Unknown design style type."));
            if (!DesignTokenValidator.IsValidName(style.Name))
                errors.Add(new("invalid-style-name", style.Id, null, "Invalid design style name.", "name"));
            if (style.Fields is null || style.Fields.Count > 16)
            {
                errors.Add(new("invalid-style-fields", style.Id, null, "Style fields are required (at most 16)."));
                continue;
            }
            var allowed = style.Type == DesignStyleType.TextStyle ? TextFields : BorderFields;
            foreach (var (name, value) in style.Fields)
            {
                if (!allowed.Contains(name) || value is null)
                    errors.Add(new("invalid-style-field", style.Id, null, "Unknown or empty style field.", name));
                if (name == "typography" && value is not (NodeTokenValue or NodeTypographyValue))
                    errors.Add(new("invalid-style-field", style.Id, null, "Typography must be a typed token reference or inline value.", name));
                if (name != "typography" && allowed.Contains(name) &&
                    NodePropertyValidator.Validate(profile, style.Type == DesignStyleType.TextStyle ? "Text" : "Frame",
                        name, value) is { } invalid)
                    errors.Add(new(invalid.Code, style.Id, null, invalid.Reason, name));
            }
        }
        var byId = document.Styles.Where(s => s is not null).GroupBy(s => s.Id)
            .ToDictionary(g => g.Key, g => g.First());
        foreach (var style in byId.Values)
        {
            if (style.BasedOnStyleId is not { } parent) continue;
            if (!byId.TryGetValue(parent, out var target))
                errors.Add(new("missing-reference", style.Id, parent, "Parent design style does not exist.", "basedOnStyleId"));
            else if (target.Type != style.Type)
                errors.Add(new("type-mismatch", style.Id, parent, "Parent design style has a different type.", "basedOnStyleId"));
        }
        if (errors.Count != 0) return errors;
        var resolver = new DesignStyleResolver(document, profile);
        foreach (var style in document.Styles)
        foreach (var theme in Enum.GetValues<TokenTheme>())
        {
            try
            {
                var fields = resolver.Resolve(style.Id, theme);
                var kind = style.Type == DesignStyleType.TextStyle ? "Text" : "Frame";
                foreach (var (name, value) in fields)
                {
                    if (NodePropertyValidator.Validate(profile, kind, name, value) is { } error)
                        errors.Add(new(error.Code, style.Id, null, $"{theme}: {error.Reason}", name));
                }
            }
            catch (DesignStyleException error)
            {
                errors.Add(new(error.Code, error.StyleId, error.ReferenceId, $"{theme}: {error.Message}", error.Field));
            }
        }
        return errors;
    }
}

// Resolves references for a theme without ever replacing the source document's IDs or fields.
public sealed class DesignStyleResolver
{
    private readonly DocumentStructure document;
    private readonly INodeProfile profile;
    private readonly DesignTokenResolver tokens;
    private readonly Dictionary<(Guid, TokenTheme), IReadOnlyDictionary<string, NodePropertyValue>> cache = [];

    public DesignStyleResolver(DocumentStructure document, INodeProfile profile)
    {
        this.document = document;
        this.profile = profile;
        tokens = new DesignTokenResolver(document.Tokens);
    }

    public IReadOnlyDictionary<string, NodePropertyValue> Resolve(Guid id, TokenTheme theme)
        => Resolve(id, theme, new HashSet<Guid>());

    private IReadOnlyDictionary<string, NodePropertyValue> Resolve(Guid id, TokenTheme theme, HashSet<Guid> visiting)
    {
        if (cache.TryGetValue((id, theme), out var cached)) return cached;
        var style = document.Styles.FirstOrDefault(item => item.Id == id)
            ?? throw Invalid("missing-reference", id, "styleId", id, "Design style does not exist.");
        if (visiting.Count >= 32 || !visiting.Add(id))
            throw Invalid("style-cycle", style.Id, "basedOnStyleId", id, "Style inheritance has a cycle or exceeds 32 levels.");
        var result = style.BasedOnStyleId is { } parent
            ? Resolve(parent, theme, visiting).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal)
            : new Dictionary<string, NodePropertyValue>(StringComparer.Ordinal);
        foreach (var (name, value) in style.Fields)
        {
            if (name == "typography")
            {
                foreach (var field in Typography(value, theme, style.Id, name))
                    result[field.Key] = field.Value;
            }
            else
            {
                var kind = style.Type == DesignStyleType.TextStyle ? "Text" : "Frame";
                result[name] = Scalar(kind, name, value, theme, style.Id);
            }
        }
        visiting.Remove(id);
        return cache[(id, theme)] = result;
    }

    private DesignStyleException Invalid(string code, Guid styleId, string field, Guid? reference, string message) =>
        new(code, styleId, field, reference, message);

    private NodePropertyValue Scalar(string kind, string name, NodePropertyValue value, TokenTheme theme, Guid owner)
    {
        if (value is not NodeTokenValue token) return value;
        if (profile.GetProperty(kind, name) is not { } definition)
            throw Invalid("invalid-style-field", owner, name, null, "Style field is not supported by the profile.");
        var (resolved, error) = NodePropertyValidator.ResolveValueToken(tokens, definition, name, token, theme);
        if (error is not null)
            throw Invalid(error.Code, owner, name, token.TokenId, error.Reason);
        return resolved!;
    }

    public IReadOnlyDictionary<string, NodePropertyValue> Typography(NodePropertyValue property,
        TokenTheme theme, Guid ownerId, string field)
    {
        TokenResolution resolution;
        if (property is NodeTokenValue token)
        {
            var definition = profile.GetProperty("Text", "typography");
            if (NodePropertyValidator.ValidateTokenReference(tokens, definition, field, token, theme) is { } invalid)
                throw Invalid(invalid.Code, ownerId, field, invalid.Id, invalid.Reason);
            resolution = tokens.Resolve(token.TokenId, theme);
        }
        else if (property is NodeTypographyValue { Value: TypographyFieldsValue fields })
            resolution = tokens.ResolveInlineTypography(fields, theme, ownerId, "style.typography");
        else if (property is NodeTypographyValue { Value: TypographyValue flat })
            resolution = DesignTokenValidator.Matches(TokenType.Typography, flat)
                ? new(flat, []) : new(null, [new("type-mismatch", ownerId, theme, null, "Invalid inline Typography.")]);
        else throw Invalid("type-mismatch", ownerId, field, null, "Typography must be a token reference or typed inline value.");

        if (!resolution.IsSuccess || resolution.Value is not TypographyValue result)
        {
            var error = resolution.Diagnostics.FirstOrDefault();
            throw Invalid(error?.Code ?? "type-mismatch", ownerId, error?.Field ?? field,
                error?.ReferenceId, error?.Message ?? "Typography could not be resolved.");
        }
        return new Dictionary<string, NodePropertyValue>(StringComparer.Ordinal)
        {
            ["fontFamily"] = new NodeStringValue(result.FontFamily),
            ["fontSize"] = new NodeNumberValue(result.FontSize),
            ["fontWeight"] = new NodeNumberValue(result.FontWeight),
            ["lineHeight"] = new NodeNumberValue(result.LineHeight)
        };
    }

    public IReadOnlyDictionary<string, NodePropertyValue> EffectiveNode(NodeStructure node,
        TokenTheme theme, IReadOnlyDictionary<string, NodePropertyValue>? variant = null)
    {
        var properties = new Dictionary<string, NodePropertyValue>(StringComparer.Ordinal);
        void ApplyStyle(IReadOnlyDictionary<string, NodePropertyValue> source, string name, DesignStyleType type)
        {
            if (!source.TryGetValue(name, out var value)) return;
            if (value is not NodeStyleValue reference)
                throw Invalid("type-mismatch", node.Id, name, null, "Expected a typed style reference.");
            var style = document.Styles.FirstOrDefault(s => s.Id == reference.StyleId);
            if (style is null || style.Type != type)
                throw Invalid("type-mismatch", node.Id, name, reference.StyleId, "Incompatible or absent design style.");
            foreach (var item in Resolve(style.Id, theme))
                properties[item.Key] = item.Value;
        }
        void ApplyTypography(IReadOnlyDictionary<string, NodePropertyValue> source)
        {
            if (source.TryGetValue("typography", out var value))
                foreach (var item in Typography(value, theme, node.Id, "typography"))
                    properties[item.Key] = item.Value;
        }
        void ApplyIndividual(IReadOnlyDictionary<string, NodePropertyValue> source)
        {
            foreach (var (name, value) in source)
                if (name is not ("textStyle" or "borderStyle" or "typography"))
                    properties[name] = Scalar(node.Kind, name, value, theme, node.Id);
        }
        ApplyStyle(node.Properties, "textStyle", DesignStyleType.TextStyle);
        ApplyStyle(node.Properties, "borderStyle", DesignStyleType.BorderStyle);
        ApplyTypography(node.Properties);
        ApplyIndividual(node.Properties);
        if (variant is not null)
        {
            ApplyStyle(variant, "textStyle", DesignStyleType.TextStyle);
            ApplyStyle(variant, "borderStyle", DesignStyleType.BorderStyle);
            ApplyTypography(variant);
            ApplyIndividual(variant);
        }
        return properties;
    }
}
