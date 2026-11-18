using System.Text;
using System.Text.Json;

namespace FigVam.Domain.Documents;

public sealed record DocumentDataset(Guid Id,
    [property: System.ComponentModel.DataAnnotations.StringLength(256, MinimumLength = 1)] string Name,
    [property: System.ComponentModel.DataAnnotations.StringLength(DatasetValidator.MaxFixtureBytes, MinimumLength = 1)] string FixtureJson,
    [property: System.ComponentModel.DataAnnotations.StringLength(128, MinimumLength = 1),
        System.ComponentModel.DataAnnotations.RegularExpression(@"^[A-Za-z0-9_.-]+$")] string? ConnectorId = null);

public static class DatasetValidator
{
    public const int MaxFixtureBytes = 64 * 1024;
    public const int MaxFixtureDepth = 32;
    public const int MaxDatasets = 1000;
    public const int MaxDocumentFixtureBytes = 8 * 1024 * 1024;

    public static bool IsValidConnectorId(string? id) => id is { Length: >= 1 and <= 128 } &&
        id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.');

    public static bool IsValidName(string? name) => !string.IsNullOrWhiteSpace(name) && name.Length <= 256 && !name.Any(char.IsControl);

    public static bool IsValidFixture(string? json)
    {
        if (json is null || json.Length > MaxFixtureBytes || Encoding.UTF8.GetByteCount(json) > MaxFixtureBytes) return false;
        try
        {
            using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = MaxFixtureDepth });
            // Duplicate keys make property paths ambiguous for later bindings.
            return HasUniqueKeys(parsed.RootElement);
        }
        catch (JsonException) { return false; }
        catch (ArgumentException) { return false; }
    }

    private static bool HasUniqueKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
                if (!keys.Add(property.Name) || !HasUniqueKeys(property.Value)) return false;
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) if (!HasUniqueKeys(item)) return false;
        return true;
    }

    public static bool IsValid(IReadOnlyList<DocumentDataset>? datasets) => datasets is not null &&
        datasets.Count <= MaxDatasets && datasets.All(d => d is not null && d.Id != Guid.Empty && IsValidName(d.Name) && IsValidFixture(d.FixtureJson) && (d.ConnectorId is null || IsValidConnectorId(d.ConnectorId))) &&
        datasets.Sum(d => (long)Encoding.UTF8.GetByteCount(d.FixtureJson)) <= MaxDocumentFixtureBytes;
}
