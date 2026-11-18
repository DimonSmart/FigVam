using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record DocumentJsonExport(int SchemaVersion, long Revision,
    DocumentVersionMetadata? SavedVersion, DocumentStructure Document);
public sealed record DocumentJsonExportResult(string Code, byte[]? Content = null);

public interface IDocumentJsonExporter
{
    Task<DocumentJsonExportResult> ExportAsync(Guid documentId, long? revision, Guid? versionId,
        DocumentActor actor, CancellationToken cancellationToken = default);
}

// This format is independent of storage serializers and HTTP serializer settings.
public static class DocumentJsonFormat
{
    public const int SchemaVersion = 1;
    public const int MaxBytes = 16 * 1024 * 1024;
    public static JsonSerializerOptions CreateOptions() => new(JsonSerializerDefaults.Web)
    {
        AllowOutOfOrderMetadataProperties = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };

    public static byte[] Serialize(DocumentJsonExport export)
    {
        var value = JsonSerializer.SerializeToNode(export, CreateOptions())!;
        return JsonSerializer.SerializeToUtf8Bytes(Sort(value));
    }

    private static JsonNode? Sort(JsonNode? value) => value switch
    {
        JsonObject obj => new JsonObject(obj.OrderBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => new KeyValuePair<string, JsonNode?>(p.Key, Sort(p.Value)))),
        JsonArray array => new JsonArray(array.Select(Sort).ToArray()),
        _ => value?.DeepClone()
    };
}

public sealed class DocumentJsonExporter(IDocumentAuthorization authorization, IDocumentStateReader reader,
    IDocumentVersionStore versions, INodeProfile profile) : IDocumentJsonExporter
{
    public async Task<DocumentJsonExportResult> ExportAsync(Guid documentId, long? revision, Guid? versionId,
        DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        // As with token export, Viewer export requires a policy that is not yet represented.
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || versionId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (revision.HasValue && versionId.HasValue) return new("INVALID_QUERY");

        DocumentState state;
        DocumentVersionMetadata? metadata = null;
        if (versionId is { } savedId)
        {
            var read = await versions.ReadVersionAsync(documentId, savedId, cancellationToken);
            if (read.Version is not { } saved) return new(read.Code);
            state = saved.Snapshot;
            if (saved.Id != savedId) return new("INVALID_VERSION");
            metadata = new(saved.Id, saved.Name, saved.Timestamp, saved.AuthorId, state.Revision);
        }
        else
        {
            var read = await reader.ReadAsync(documentId, revision, cancellationToken);
            if (read.State is not { } current) return new(read.Code);
            state = current;
        }
        if (state.Document.Id != documentId || state.Revision < 0 ||
            revision.HasValue && state.Revision != revision.Value) return new("INVALID_DOCUMENT");
        if (PortableUiProfileResolver.Validate(state.Document.Profile, profile) is { } profileError)
            return new(profileError.Code);
        try
        {
            var content = DocumentJsonFormat.Serialize(new(DocumentJsonFormat.SchemaVersion, state.Revision, metadata, state.Document));
            if (content.Length > DocumentJsonFormat.MaxBytes) return new("EXPORT_TOO_LARGE");
            // Standalone JSON retains the manifest; reopening requires the container's content.
            using var parsed = JsonDocument.Parse(content);
            if (!DocumentAssetValidator.IsValid(state.Document.Assets) ||
                state.Document.Assets.Count == 0 && HasAssetReference(parsed.RootElement.GetProperty("document"))) return new("EXPORT_DEPENDENCY_UNAVAILABLE");
            cancellationToken.ThrowIfCancellationRequested();
            return new("OK", content);
        }
        catch (NotSupportedException) { return new("EXPORT_UNSUPPORTED_DATA"); }
        catch (JsonException) { return new("EXPORT_UNSUPPORTED_DATA"); }
        catch (ArgumentException) { return new("EXPORT_UNSUPPORTED_DATA"); }
    }

    private static bool HasAssetReference(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            if (value.TryGetProperty("assetId", out _)) return true;
            return value.EnumerateObject().Any(p => HasAssetReference(p.Value));
        }
        return value.ValueKind == JsonValueKind.Array && value.EnumerateArray().Any(HasAssetReference);
    }
}
