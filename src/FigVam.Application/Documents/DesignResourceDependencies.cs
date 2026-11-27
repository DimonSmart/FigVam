using FigVam.Domain.Components;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

// Reversed resource-reference graph. Built solely from one immutable document revision;
// neither preview state nor browser caches participate in dependency decisions.
public sealed record DesignResourceUse(string Kind, Guid OwnerId, string? Property, TokenTheme? Theme,
    Guid? ParameterId, bool Indirect, IReadOnlyList<Guid> Chain, string Label);

public sealed class DesignResourceDependencies
{
    private sealed record Edge(string SourceKind, Guid SourceId, string Kind, Guid OwnerId,
        string? Property, TokenTheme? Theme, Guid? ParameterId,
        string? NextKind, Guid? NextId);
    private readonly DocumentStructure document;
    private readonly Dictionary<(string Kind, Guid Id), List<Edge>> incoming = [];

    public DesignResourceDependencies(DocumentStructure document)
    {
        this.document = document;
        foreach (var token in document.Tokens)
        foreach (var (theme, expression) in token.Values)
        {
            if (expression is TokenAlias alias)
                Add("token", alias.TokenId, "tokenAlias", token.Id, null, theme, null, "token", token.Id);
            if (expression is LiteralTokenValue { Value: ShadowFieldsValue { Color: TokenAlias color } })
                Add("token", color.TokenId, "tokenShadowField", token.Id, "shadow.color", theme, null, "token", token.Id);
            if (expression is LiteralTokenValue { Value: TypographyFieldsValue fields })
                Fields(fields, "tokenTypographyField", token.Id, "typography", theme, null, "token", token.Id);
        }
        foreach (var style in document.Styles)
        {
            if (style.BasedOnStyleId is { } parent)
                Add("style", parent, "styleInheritance", style.Id, "basedOnStyleId", null, null, "style", style.Id);
            foreach (var (name, value) in style.Fields)
                Property("styleField", style.Id, name, value, null, null, "style", style.Id);
        }
        foreach (var node in document.Nodes)
            foreach (var (name, value) in node.Properties)
                Property("nodeProperty", node.Id, name, value);
        foreach (var screen in document.Screens)
        foreach (var variant in screen.Variants)
        foreach (var entry in variant.Overrides)
            Property("screenVariantOverride", variant.Id, entry.Property, entry.Value);
        foreach (var definition in document.ComponentDefinitions)
        {
            foreach (var parameter in definition.Parameters)
                Component("componentParameterDefault", definition.Id, parameter.Id, parameter.DefaultValue);
            foreach (var variant in definition.Variants)
            foreach (var (parameterId, value) in variant.ParameterChanges)
                Component("componentVariantParameterChange", variant.Id, parameterId, value);
        }
        foreach (var instance in document.ComponentInstances)
        foreach (var (parameterId, value) in instance.ParameterOverrides)
            Component("componentInstanceParameterOverride", instance.NodeId, parameterId, value);
    }

    private void Add(string sourceKind, Guid sourceId, string kind, Guid ownerId,
        string? property, TokenTheme? theme = null, Guid? parameter = null,
        string? nextKind = null, Guid? nextId = null)
    {
        var key = (sourceKind, sourceId);
        if (!incoming.TryGetValue(key, out var edges)) incoming[key] = edges = [];
        edges.Add(new(sourceKind, sourceId, kind, ownerId, property, theme, parameter, nextKind, nextId));
    }

    private void Fields(TypographyFieldsValue fields, string kind, Guid ownerId, string property,
        TokenTheme? theme = null, Guid? parameter = null, string? nextKind = null, Guid? nextId = null)
    {
        void Field(string name, TokenExpression? expression)
        {
            if (expression is TokenAlias alias)
                Add("token", alias.TokenId, kind, ownerId, property + "." + name, theme, parameter, nextKind, nextId);
        }
        Field("fontFamily", fields.FontFamily);
        Field("fontSize", fields.FontSize);
        Field("fontWeight", fields.FontWeight);
        Field("lineHeight", fields.LineHeight);
        Field("letterSpacing", fields.LetterSpacing);
    }

    private void Property(string kind, Guid ownerId, string property, NodePropertyValue value,
        TokenTheme? theme = null, Guid? parameter = null, string? nextKind = null, Guid? nextId = null)
    {
        if (value is NodeTokenValue token)
            Add("token", token.TokenId, kind, ownerId, property, theme, parameter, nextKind, nextId);
        if (value is NodeStyleValue style)
            Add("style", style.StyleId, kind, ownerId, property, theme, parameter, nextKind, nextId);
        if (value is NodeTypographyValue { Value: TypographyFieldsValue fields })
            Fields(fields, kind, ownerId, property, theme, parameter, nextKind, nextId);
    }

    private void Component(string kind, Guid owner, Guid parameter, ComponentValue value)
    {
        if (value is ComponentToken token) Add("token", token.TokenId, kind, owner, null, null, parameter);
        if (value is ComponentStyle style) Add("style", style.StyleId, kind, owner, null, null, parameter);
    }

    public IReadOnlyList<DesignResourceUse> Usages(string resourceKind, Guid resourceId, int maxDepth = 32)
    {
        if (resourceKind is not ("token" or "style") || resourceId == Guid.Empty || maxDepth is < 1 or > 32)
            throw new ArgumentOutOfRangeException(nameof(maxDepth));
        var result = new List<DesignResourceUse>();
        var visited = new HashSet<(string, Guid)> { (resourceKind, resourceId) };
        void Walk(string kind, Guid id, TokenTheme? theme, IReadOnlyList<Guid> path, int depth)
        {
            if (depth >= maxDepth || result.Count >= 10000 || !incoming.TryGetValue((kind, id), out var edges)) return;
            foreach (var edge in edges)
            {
                if (theme is not null && edge.Theme is not null && theme != edge.Theme) continue;
                var effectiveTheme = edge.Theme ?? theme;
                var chain = path.Concat([edge.OwnerId]).ToArray();
                result.Add(new(edge.Kind, edge.OwnerId, edge.Property, effectiveTheme, edge.ParameterId,
                    path.Count > 1, chain, Label(edge.Kind, edge.OwnerId)));
                if (edge.NextKind is { } next && edge.NextId is { } target && visited.Add((next, target)))
                {
                    Walk(next, target, effectiveTheme, chain, depth + 1);
                    visited.Remove((next, target));
                }
                if (result.Count >= 10000) break;
            }
        }
        Walk(resourceKind, resourceId, null, [resourceId], 0);
        return result.DistinctBy(x => (x.Kind, x.OwnerId, x.Property, x.Theme, x.ParameterId,
                string.Join("/", x.Chain)))
            .OrderBy(x => x.Indirect).ThenBy(x => x.Kind, StringComparer.Ordinal).ThenBy(x => x.OwnerId)
            .ThenBy(x => x.Property, StringComparer.Ordinal).ThenBy(x => x.Theme)
            .ThenBy(x => x.ParameterId).ThenBy(x => string.Join("/", x.Chain), StringComparer.Ordinal).ToArray();
    }

    private string Label(string kind, Guid id) => kind switch
    {
        "tokenAlias" or "tokenTypographyField" => document.Tokens.FirstOrDefault(t => t.Id == id)?.Name ?? "Token",
        "styleField" or "styleInheritance" => document.Styles.FirstOrDefault(s => s.Id == id)?.Name ?? "Style",
        "nodeProperty" => document.Nodes.FirstOrDefault(n => n.Id == id) is { } node
            ? (string.IsNullOrWhiteSpace(node.Name) ? node.Kind : node.Name) : "Node",
        "screenVariantOverride" => document.Screens.SelectMany(s => s.Variants).FirstOrDefault(v => v.Id == id)?.Name ?? "Variant",
        "componentParameterDefault" => document.ComponentDefinitions.FirstOrDefault(d => d.Id == id)?.Name ?? "Component",
        "componentVariantParameterChange" => document.ComponentDefinitions.SelectMany(d => d.Variants).FirstOrDefault(v => v.Id == id)?.Name ?? "Component variant",
        "componentInstanceParameterOverride" => document.Nodes.FirstOrDefault(n => n.Id == id)?.Name ?? "Component instance",
        _ => kind
    };
}
