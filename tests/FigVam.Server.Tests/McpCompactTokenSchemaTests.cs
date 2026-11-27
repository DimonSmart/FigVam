using FigVam.Domain.Tokens;
using FigVam.Server.Mcp;

namespace FigVam.Server.Tests;

public sealed class McpCompactTokenSchemaTests
{
    [Fact]
    public void AllTypesKeepSharedMetadataAndComplexSchemasAreSmaller()
    {
        var reader = new McpReadTools(null!, null!, null!, null!);
        foreach (var type in Enum.GetValues<TokenType>())
        {
            var full = reader.GetTokenSchema(type.ToString()).StructuredContent!.Value;
            var compact = reader.GetTokenSchema(type.ToString(), compact: true).StructuredContent!.Value;
            Assert.Equal(type.ToString(), compact.GetProperty("type").GetString());
            Assert.Equal(full.GetProperty("example").GetRawText(), compact.GetProperty("example").GetRawText());
            Assert.Equal(full.GetProperty("category").GetProperty("allowedValues").GetRawText(),
                compact.GetProperty("category").GetProperty("allowedValues").GetRawText());
            Assert.Equal(full.GetProperty("themes").GetRawText(), compact.GetProperty("themes").GetRawText());
            Assert.True(compact.GetProperty("compact").GetBoolean());
            if (type is TokenType.Dimension or TokenType.Typography)
                Assert.True(compact.GetRawText().Length <= full.GetRawText().Length * .7,
                    $"{type}: {compact.GetRawText().Length}/{full.GetRawText().Length}");
        }
    }
}
