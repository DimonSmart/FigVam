using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Server.Tests;

// Test double with no supported node kinds; not a production profile.
internal sealed class EmptyNodeProfile : INodeProfile
{
    public PortableUiProfileReference Identity => PortableUiProfileReference.Current;
    public bool IsKnownKind(string kind) => false;
    public bool CanContainChildren(string kind) => false;
    public NodePropertyDefinition? GetProperty(string kind, string property) => null;
    public bool SupportsPreviewEvent(string kind, PreviewEvent @event) => false;
    public bool SupportsPreviewAction(PreviewAction action) => false;
    public bool SupportsDemoValue(string kind) => false;
}
