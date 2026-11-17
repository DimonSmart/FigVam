namespace FigVam.Server.Tests;

// Each test owns real server or crash-writer processes. Launching all classes in
// parallel makes cold application startup compete with nested vstest runners.
[CollectionDefinition(Name)]
public sealed class ProcessTestCollection
{
    public const string Name = "Child process integration tests";
}
