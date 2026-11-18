namespace FigVam.Domain.Documents;

public sealed record PortableUiProfileReference(
    [property: System.Text.Json.Serialization.JsonRequired] string Id,
    [property: System.Text.Json.Serialization.JsonRequired] int Version)
{
    public static PortableUiProfileReference Production { get; } = new("figvam.portable-ui", 1);
}

public sealed record ProfileResolutionDiagnostic(string Code, string Message);

public sealed class PortableUiProfileException(ProfileResolutionDiagnostic diagnostic) : Exception(diagnostic.Message)
{
    public string Code => diagnostic.Code;
}

// Only the exact installed profile may interpret a document's capabilities.
public static class PortableUiProfileResolver
{
    public static ProfileResolutionDiagnostic? Validate(PortableUiProfileReference? requested, INodeProfile available)
    {
        ArgumentNullException.ThrowIfNull(available);
        if (requested is null || string.IsNullOrWhiteSpace(requested.Id) || requested.Id.Length > 128 || requested.Version < 1)
            return new("INVALID_PROFILE", "A Portable UI Profile ID and positive version are required.");
        if (!string.Equals(requested.Id, available.Identity.Id, StringComparison.Ordinal))
            return new("PROFILE_UNAVAILABLE", $"Portable UI Profile '{requested.Id}' is not installed.");
        if (requested.Version != available.Identity.Version)
            return new("UNSUPPORTED_PROFILE_VERSION", $"Portable UI Profile '{requested.Id}' version {requested.Version} is unavailable; installed version is {available.Identity.Version}.");
        return null;
    }
}
