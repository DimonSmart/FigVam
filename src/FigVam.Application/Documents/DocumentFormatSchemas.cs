using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;

namespace FigVam.Application.Documents;

public static class DocumentFormatSchemas
{
    public static JsonNode CreateDocumentFormat()
    {
        var options = FigVam.Application.Documents.DocumentJsonFormat.CreateOptions();
        options.MakeReadOnly(populateMissingResolver: true);
        var schema = options.GetJsonSchemaAsNode(typeof(FigVam.Application.Documents.DocumentJsonExport),
            new JsonSchemaExporterOptions { TreatNullObliviousAsNonNullable = true });
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
        schema["$id"] = "urn:figvam:document:1";
        schema["properties"]!["schemaVersion"]!["const"] = 1;
        schema["properties"]!["revision"]!["minimum"] = 0;
        schema["required"] = new JsonArray("schemaVersion", "revision", "savedVersion", "document");
        var name = schema["properties"]!["document"]!["properties"]!["name"]!;
        name["minLength"] = 1;
        name["maxLength"] = 256;
        name["pattern"] = @"^(?!\s*$)[^\u0000-\u001F\u007F-\u009F]+$";
        var profile = schema["properties"]!["document"]!["properties"]!["profile"]!;
        profile["properties"]!["id"]!["minLength"] = 1;
        profile["properties"]!["id"]!["maxLength"] = 128;
        profile["properties"]!["version"]!["minimum"] = 1;
        return schema;
    }

    public static JsonNode CreateManifestFormat() => JsonNode.Parse("""
        {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:figvam:manifest:1",
         "type":"object","additionalProperties":false,"required":["schemaVersion","files"],
         "properties":{"schemaVersion":{"const":1},"files":{"type":"array","minItems":1,"maxItems":257,
           "items":{"type":"object","additionalProperties":false,"required":["path","size","sha256"],
             "properties":{"path":{"type":"string","pattern":"^(document\\.json|assets/[0-9a-f]{32}\\.png)$"},"size":{"type":"integer","minimum":0,"maximum":16777216},
               "sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}}}}}}
        """)!;

}
