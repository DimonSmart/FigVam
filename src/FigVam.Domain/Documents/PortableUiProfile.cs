namespace FigVam.Domain.Documents;

public sealed record PortableUiProfileReference(
    [property: System.Text.Json.Serialization.JsonRequired] string Id,
    [property: System.Text.Json.Serialization.JsonRequired] int Version)
{
    public static PortableUiProfileReference Current { get; } = new("figvam.portable-ui", 4);
}

public sealed record ProfileResolutionDiagnostic(string Code, string Message);

public sealed class PortableUiProfileException(ProfileResolutionDiagnostic diagnostic) : Exception(diagnostic.Message)
{
    public string Code => diagnostic.Code;
}

public static class PortableUiProfileResolver
{
    public static ProfileResolutionDiagnostic? Validate(PortableUiProfileReference? requested, INodeProfile available) =>
        Resolve(requested, available, out _);

    public static INodeProfile Require(PortableUiProfileReference? requested, INodeProfile available) =>
        Resolve(requested, available, out var selected) is { } error ? throw new PortableUiProfileException(error) : selected!;

    public static ProfileResolutionDiagnostic? Resolve(PortableUiProfileReference? requested, INodeProfile available, out INodeProfile? selected)
    {
        ArgumentNullException.ThrowIfNull(available);
        selected = null;
        if (requested is null || string.IsNullOrWhiteSpace(requested.Id) || requested.Id.Length > 128 || requested.Version < 1)
            return new("INVALID_PROFILE", "A Portable UI Profile ID and positive version are required.");
        if (!string.Equals(requested.Id, available.Identity.Id, StringComparison.Ordinal))
            return new("PROFILE_UNAVAILABLE", $"Portable UI Profile '{requested.Id}' is not installed.");
        if (available.Identity != requested)
            return new("UNSUPPORTED_PROFILE_VERSION", $"Portable UI Profile '{requested.Id}' version {requested.Version} is unavailable.");
        selected = available;
        return null;
    }
}
