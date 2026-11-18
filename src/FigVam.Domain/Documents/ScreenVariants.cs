namespace FigVam.Domain.Documents;

public sealed record ScreenPropertyOverride(Guid NodeId, string Property, NodePropertyValue Value);
public sealed record ScreenVariant(Guid Id, string Name, IReadOnlyList<ScreenPropertyOverride> Overrides);

public static class ScreenVariantEditor
{
    public static NodePropertyValue? ResolveProperty(ScreenVariant variant, NodeStructure node, string property)
        => variant.Overrides.FirstOrDefault(o => o.NodeId == node.Id && o.Property == property)?.Value
            ?? node.Properties.GetValueOrDefault(property);

    public static DocumentStructure Set(DocumentStructure document, Guid screenId, ScreenVariant variant)
        => document with { Screens = document.Screens.Select(s => s.Id != screenId ? s : s with {
            Variants = s.Variants.Any(v => v.Id == variant.Id)
                ? s.Variants.Select(v => v.Id == variant.Id ? variant : v).ToArray() : [.. s.Variants, variant] }).ToArray() };
}

public static class ScreenVariantValidator
{
    public static IReadOnlyList<StructureError> Validate(DocumentStructure document, ScreenStructure screen, INodeProfile profile)
    {
        var errors = new List<StructureError>();
        var nodes = document.Nodes.GroupBy(n => n.Id).ToDictionary(g => g.Key, g => g.First());
        var reachable = new HashSet<Guid>();
        var pending = new Stack<Guid>(screen.ChildIds);
        while (pending.TryPop(out var id))
            if (reachable.Add(id) && nodes.TryGetValue(id, out var node)) foreach (var child in node.ChildIds) pending.Push(child);
        if (screen.Variants.Count > 1000) errors.Add(new("INVALID_SCREEN_VARIANT", screen.Id, null, "At most 1000 variants per screen are allowed."));
        foreach (var variant in screen.Variants)
        {
            if (variant is null || string.IsNullOrWhiteSpace(variant.Name) || !NodeMetadataValidator.IsValidName(variant.Name) || variant.Overrides is null || variant.Overrides.Count > 10000)
            { errors.Add(new("INVALID_SCREEN_VARIANT", screen.Id, null, "A bounded variant with a nonblank name and overrides is required.")); continue; }
            var targets = new HashSet<(Guid, string)>();
            foreach (var item in variant.Overrides)
            {
                if (item is null) { errors.Add(new("INVALID_SCREEN_VARIANT", variant.Id, null, "An override is required.")); continue; }
                if (!targets.Add((item.NodeId, item.Property))) errors.Add(new("INVALID_SCREEN_VARIANT", variant.Id, item.NodeId, "Duplicate property override.", item.Property));
                if (!reachable.Contains(item.NodeId) || !nodes.TryGetValue(item.NodeId, out var node))
                { errors.Add(new("INVALID_VARIANT_NODE", variant.Id, item.NodeId, "Override node must belong to the variant screen.", item.Property)); continue; }
                if (NodePropertyValidator.Validate(profile, node.Kind, item.Property, item.Value) is { } invalid)
                    errors.Add(new(invalid.Code, variant.Id, item.NodeId, invalid.Reason, item.Property));
                if (item.Value is NodeTokenValue reference)
                {
                    var token = document.Tokens.FirstOrDefault(t => t.Id == reference.TokenId);
                    if (token is null) errors.Add(new("missing-reference", variant.Id, reference.TokenId, "Referenced token does not exist.", item.Property));
                    else if (profile.GetProperty(node.Kind, item.Property)?.TokenType is { } expected && token.Type != expected)
                        errors.Add(new("type-mismatch", variant.Id, reference.TokenId, "Token type does not match the property.", item.Property));
                }
                if (item.Value is NodeAssetValue asset && !document.Assets.Any(a => a.Id == asset.AssetId)) errors.Add(new("missing-reference", variant.Id, asset.AssetId, "Referenced asset does not exist in this document snapshot.", item.Property));
            }
        }
        return errors;
    }
}
