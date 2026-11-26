using System.Text.Json.Nodes;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

internal static class McpTokenSchemas
{
    internal static object Describe(TokenType type)
    {
        var categories = Enum.GetValues<TokenCategory>().Where(c => DesignTokenValidator.ValidCategory(type, c)).ToArray();
        var noCategory = DesignTokenValidator.ValidCategory(type, null);
        var schemas = categories.ToDictionary(c => c.ToString(), c => McpPropertyContracts.TokenInputSchema(type, c));
        var valueSchema = noCategory ? McpPropertyContracts.TokenInputSchema(type) :
            new JsonObject { ["anyOf"] = new JsonArray(schemas.Values.Select(s => s.DeepClone()).ToArray()) };
        object example = type switch
        {
            TokenType.Color => "#2563EB",
            TokenType.Shadow => new { offsetX = 0, offsetY = 4, blurRadius = 8, spreadRadius = 0, color = "#00000026" },
            TokenType.Spacing => new { expression = "literal", value = new { type = "spacing", value = 8 } },
            TokenType.Geometry => 8,
            TokenType.Dimension => 1,
            TokenType.Number => 1,
            TokenType.FontFamily => "Arial",
            TokenType.FontWeight => 400,
            TokenType.Typography => new { fontFamily = "Arial", fontSize = 16, fontWeight = 400, lineHeight = 1.25 },
            _ => throw new ArgumentOutOfRangeException(nameof(type))
        };
        return new
        {
            type = type.ToString(),
            description = type switch
            {
                TokenType.Color => "Reusable RGBA color.",
                TokenType.Shadow => "Reusable single drop shadow with themed geometry and RGBA color.",
                TokenType.Spacing => "Legacy spacing token; prefer Dimension with category Spacing.",
                TokenType.Geometry => "Legacy nonnegative corner radius.",
                TokenType.Dimension => "Dimension in logical UI units, constrained by its semantic category.",
                TokenType.Number => "Unitless number, constrained by its semantic category.",
                TokenType.FontFamily => "Atomic font family name.",
                TokenType.FontWeight => "Atomic integer font weight.",
                TokenType.Typography => "Flat typography or canonical typographyFields with atomic literal/alias expressions.",
                _ => throw new ArgumentOutOfRangeException(nameof(type))
            },
            category = new { supported = categories.Length > 0, required = !noCategory, allowedValues = categories.Select(c => c.ToString()),
                description = noCategory ? "Omit category." : "Required; use the corresponding valueSchemaByCategory for both themes." },
            valueSchema,
            valueSchemaByCategory = categories.Length == 0 ? null : schemas,
            example,
            themes = new { allowedValues = Enum.GetNames<TokenTheme>(), create = "Both light and dark are required; each is an independent value or alias.",
                update = "Set one theme by name with set_token_value; the other theme is unchanged." },
            references = new
            {
                description = "Compact {tokenId} or canonical {expression:alias,tokenId}; nested typographyFields use canonical expressions only.",
                requiresExistingToken = true,
                sameTheme = true,
                cyclesAllowed = false,
                targetType = type.ToString(),
                targetCategoryMatches = true,
                typographyFields = type == TokenType.Typography ? DesignTokenValidator.TypographyFieldTypes.ToDictionary(
                    field => field.Key, field => new { type = field.Value.Type.ToString(), category = field.Value.Category?.ToString() }) : null
            },
            legacySpacing = type == TokenType.Spacing ? new
            {
                description = "create_token without category and with two noncanonical values creates Dimension/Spacing instead. If either value has an expression discriminator, the actual type remains Spacing. set_token_value always uses the stored type. Use the canonical example to create actual Spacing.",
                compactCreateValueSchema = McpPropertyContracts.LegacySpacingCreateSchema()
            } : null
        };
    }
}
