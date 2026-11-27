using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

internal static class McpTokenSchemas
{
    internal static object Describe(TokenType type, bool compact = false)
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
        var full = new
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
        if (!compact) return full;

        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        var response = JsonSerializer.SerializeToNode(full, options)!.AsObject();
        response.Remove("valueSchema");
        response.Remove("valueSchemaByCategory");
        response["compact"] = true;
        response["category"]!["description"] = noCategory ? "Omit category." : "Required; use literalSchemaByCategory for both themes.";
        response["formats"] = JsonSerializer.SerializeToNode(new
        {
            compactAlias = new { tokenId = "UUID" },
            canonicalAlias = new { expression = "alias", tokenId = "UUID" },
            canonicalLiteral = "{expression:literal,value:<canonical value>}",
            scalarCanonicalValue = "{type:<canonicalTag>,<payloadField>:<compact literal>}",
            nestedField = "Canonical alias or canonical literal expression. A nested field must match its documented type and category."
        }, options);
        if (noCategory)
            response["literalSchema"] = McpPropertyContracts.CompactTokenLiteral(type);
        else
            response["literalSchemaByCategory"] = new JsonObject(categories.Select(c =>
                KeyValuePair.Create<string, JsonNode?>(c.ToString(), McpPropertyContracts.CompactTokenLiteral(type, c))));
        if (type == TokenType.Typography)
        {
            response["canonicalTag"] = "typography";
            response["canonicalValue"] = "Add type:typography to the compact literal; alternatively use type:typographyFields and the field expressions below.";
            var fields = response["references"]!["typographyFields"]!.AsObject();
            foreach (var (name, contract) in DesignTokenValidator.TypographyFieldTypes)
            {
                var field = fields[name]!.AsObject();
                var canonical = McpPropertyContracts.CanonicalTokenLiteral(contract.Type, contract.Category);
                field["canonicalTag"] = canonical["properties"]!["type"]!["const"]!.DeepClone();
                field["payloadField"] = "value";
                field["literalSchema"] = McpPropertyContracts.CompactTokenLiteral(contract.Type, contract.Category);
                field["required"] = name != "letterSpacing";
                if (name == "letterSpacing") field["default"] = 0;
            }
        }
        else if (type is TokenType.Color or TokenType.Shadow)
            response["canonicalValueSchema"] = McpPropertyContracts.CanonicalTokenLiteral(type);
        else
        {
            var canonical = McpPropertyContracts.CanonicalTokenLiteral(type, categories.Length > 0 ? categories[0] : null);
            var properties = canonical["properties"]!.AsObject();
            response["canonicalTag"] = properties["type"]!["const"]!.DeepClone();
            response["payloadField"] = properties.Single(p => p.Key != "type").Key;
        }
        return response;
    }
}
