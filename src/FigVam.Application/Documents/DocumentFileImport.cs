using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public enum DocumentFileFormat { Json, FigVam }
public sealed record ImportDocumentCommand(DocumentFileFormat Format, Stream Content);
public sealed record DocumentImportResponse(string Code, Guid DocumentId, long Revision);
public sealed record DocumentImportFailure(string Code, IReadOnlyList<DocumentReadDiagnostic> Diagnostics);
public sealed record DocumentImportResult(string Code, Guid DocumentId = default,
    IReadOnlyList<DocumentReadDiagnostic>? Diagnostics = null);

public interface IDocumentFileImporter
{
    Task<DocumentImportResult> ImportAsync(ImportDocumentCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
}

// Creates only a new revision-zero baseline and its Owner in one transaction.
public interface IDocumentImportStore
{
    Task<DocumentAccessResult> CreateImportedAsync(DocumentStructure document, IReadOnlyList<DocumentAssetContent> assets, DocumentActor actor,
        CancellationToken cancellationToken = default);
}

public sealed class DocumentFileImporter(IDocumentFileReader reader, IDocumentImportStore store) : IDocumentFileImporter
{
    public async Task<DocumentImportResult> ImportAsync(ImportDocumentCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id)) return new("FORBIDDEN");
        var read = command.Format switch
        {
            DocumentFileFormat.Json => await reader.ReadJsonAsync(command.Content, cancellationToken),
            DocumentFileFormat.FigVam => await reader.ReadContainerAsync(command.Content, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };
        if (read.Document is null || read.Diagnostics.Count != 0)
            return new(read.Diagnostics.Any(d => d.Code == "FILE_TOO_LARGE") ? "FILE_TOO_LARGE" : "INVALID_DOCUMENT_FILE",
                Diagnostics: read.Diagnostics);
        // Source revision and saved-version metadata describe the source, not this journal.
        var created = await store.CreateImportedAsync(read.Document.Document, read.Assets, actor, cancellationToken);
        return new(created.Code, created.DocumentId);
    }
}
