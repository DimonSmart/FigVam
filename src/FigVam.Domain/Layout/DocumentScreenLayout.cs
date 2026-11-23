using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;

namespace FigVam.Domain.Layout;

public static class DocumentScreenLayout
{
    public static LayoutResult Calculate(DocumentStructure document, Guid screenId, INodeProfile installedProfile,
        ScreenDimensions? viewport = null, TokenTheme theme = TokenTheme.Light)
    {
        if (PortableUiProfileResolver.Resolve(document.Profile, installedProfile, out var profile) is { } profileError)
            return new([], [new(profileError.Code, document.Id, "profile", profileError.Message)]);

        var screens = document.Screens.Where(screen => screen.Id == screenId).Take(2).ToArray();
        if (screens.Length == 0)
            return new([], [new("SCREEN_NOT_FOUND", screenId, "screenId", "The screen does not exist in this document.")]);
        if (screens.Length > 1)
            return new([], [new("duplicate-id", screenId, "id", "The screen ID is not unique.")]);

        try
        {
            var screen = screens[0];
            var dimensions = viewport ?? screen.Dimensions;
            if (!ScreenDimensions.IsValid(dimensions))
                throw Invalid("INVALID_SCREEN_DIMENSIONS", screenId, "dimensions", "Screen dimensions must be finite and nonnegative.");

            var size = new LayoutSize(dimensions.Width, dimensions.Height);
            var root = new LayoutNode(screen.Id, LayoutDimension.Fixed(size.Width), LayoutDimension.Fixed(size.Height),
                Children(screen.Id, screen.ChildIds)) { Overflow = LayoutOverflow.Clip };
            var nodes = document.Nodes.ToLookup(node => node.Id);
            var tokens = new DesignTokenResolver(document.Tokens);
            var styles = new DesignStyleResolver(document, profile!);
            var layoutNodes = new List<LayoutNode> { root };
            var visited = new HashSet<Guid> { screen.Id };
            var pending = new Stack<(Guid ParentId, Guid ChildId, int Depth)>();
            AddChildren(root, 0);
            while (pending.TryPop(out var entry))
            {
                var (parentId, childId, depth) = entry;
                var matches = nodes[childId].Take(2).ToArray();
                if (matches.Length == 0)
                    throw Invalid("missing-child", parentId, "childIds", $"Child {childId} does not exist.");
                if (matches.Length > 1 || childId == screen.Id)
                    throw Invalid("duplicate-id", childId, "id", "The node ID is not unique.");
                if (depth > DocumentStructureLimits.MaxTreeDepth)
                    throw Invalid("DOCUMENT_DEPTH", childId, "childIds", "The screen exceeds the node tree depth limit.");
                // Keep every edge for the engine to diagnose repeated children or cycles.
                if (!visited.Add(childId)) continue;
                var source = matches[0];
                var effective = styles.EffectiveNode(source, theme);
                var projectedSource = source with { Properties = source.Properties.SetItems(effective) };
                var node = ProjectNode(projectedSource, profile!, tokens, theme);
                if (DocumentStructureValidator.ValidateNodeProperties(document, source, profile!, tokens, theme).FirstOrDefault() is { } error)
                    throw Invalid(error.Code, error.ObjectId, error.Property ?? "properties", error.Message);
                layoutNodes.Add(node);
                AddChildren(node, depth);
            }

            // A node shared with a parent outside the selected screen is still invalid.
            var owned = new HashSet<Guid>();
            var childIds = document.Screens.SelectMany(item => item.ChildIds ?? [])
                .Concat(document.Nodes.SelectMany(item => item.ChildIds ?? []));
            foreach (var childId in childIds)
                if (visited.Contains(childId) && !owned.Add(childId))
                    throw Invalid("multiple-parents", childId, "childIds", "Each child must occur exactly once.");

            return ReferenceLayoutEngine.Calculate(new(screenId, layoutNodes, size));

            void AddChildren(LayoutNode parent, int depth)
            {
                for (var index = parent.ChildIds.Count - 1; index >= 0; index--)
                    pending.Push((parent.Id, parent.ChildIds[index], depth + 1));
            }
        }
        catch (InvalidLayout error)
        {
            return new([], [error.Diagnostic]);
        }
        catch (DesignStyleException error)
        {
            return new([], [new(error.Code, error.StyleId, error.Field, error.Message)]);
        }
    }

    private static LayoutNode ProjectNode(NodeStructure node, INodeProfile profile, DesignTokenResolver tokens, TokenTheme theme)
    {
        if (!profile.IsKnownKind(node.Kind))
            throw Invalid("unknown-node-kind", node.Id, "kind", $"Node kind '{node.Kind}' is not in the profile.");
        var children = Children(node.Id, node.ChildIds);
        if (children.Count > 0 && !profile.CanContainChildren(node.Kind))
            throw Invalid("children-not-allowed", node.Id, "childIds", $"Node kind '{node.Kind}' cannot contain children.");
        if (node.Properties is null)
            throw Invalid("invalid-properties", node.Id, "properties", "Node properties are required.");

        var projected = new LayoutNode(node.Id, Size("width", "widthMode"), Size("height", "heightMode"), children)
        {
            X = Number("x"),
            Y = Number("y")
        };
        if (profile.GetProperty(node.Kind, "layout") is null)
            return projected;

        return projected with
        {
            Flow = Option<LayoutFlow>("layout"),
            Padding = new(Number("paddingLeft"), Number("paddingTop"), Number("paddingRight"), Number("paddingBottom")),
            Gap = Number("gap"),
            MainAlignment = Option<LayoutAlignment>("mainAlignment"),
            CrossAlignment = Option<LayoutAlignment>("crossAlignment"),
            Overflow = Option<LayoutOverflow>("overflow")
        };

        LayoutDimension Size(string property, string modeProperty)
        {
            if (EffectiveValue(modeProperty) is NodeEnumValue { Value: nameof(LayoutSizeMode.Content) or nameof(LayoutSizeMode.Fill) } mode)
                throw Invalid("unsupported-size-mode", node.Id, modeProperty, $"Size mode '{mode.Value}' is not supported for screen geometry.");
            if (Option<LayoutSizeMode>(modeProperty) != LayoutSizeMode.Fixed)
                throw Invalid("unsupported-size-mode", node.Id, modeProperty, "Screen geometry requires a fixed size.");
            return LayoutDimension.Fixed(Number(property));
        }

        double Number(string property)
        {
            if (EffectiveValue(property) is not NodeTokenValue reference ||
                profile.GetProperty(node.Kind, property) is not { Type: NodePropertyType.Number, TokenType: not null } definition)
                return Read<NodeNumberValue>(property).Value;
            var (value, error) = NodePropertyValidator.ResolveNumberToken(tokens, definition, property, reference, theme);
            if (error is not null)
                throw Invalid(error.Code, node.Id, property, error.Reason);
            return value!.Value;
        }

        T Option<T>(string property) where T : struct, Enum
        {
            var value = Read<NodeEnumValue>(property).Value;
            if (Enum.TryParse<T>(value, out var option) && Enum.IsDefined(option) && option.ToString() == value)
                return option;
            throw Invalid("unsupported-layout-option", node.Id, property, $"Layout option '{value}' is not supported.");
        }

        NodePropertyValue? EffectiveValue(string property) => node.Properties.TryGetValue(property, out var value)
            ? value : profile.GetProperty(node.Kind, property)?.DefaultValue;

        T Read<T>(string property) where T : NodePropertyValue
        {
            var value = EffectiveValue(property);
            if (NodePropertyValidator.Validate(profile, node.Kind, property, value) is { } error)
                throw Invalid(error.Code, node.Id, property, error.Reason);
            return value as T ?? throw Invalid("unsupported-layout-property", node.Id, property, "The profile does not supply the expected layout property type.");
        }
    }

    private static IReadOnlyList<Guid> Children(Guid id, IReadOnlyList<Guid>? children) =>
        children ?? throw Invalid("invalid-children", id, "childIds", "Child IDs are required.");

    private static InvalidLayout Invalid(string code, Guid id, string property, string message) =>
        new(new(code, id, property, message));

    private sealed class InvalidLayout(LayoutDiagnostic diagnostic) : Exception
    {
        public LayoutDiagnostic Diagnostic { get; } = diagnostic;
    }
}
