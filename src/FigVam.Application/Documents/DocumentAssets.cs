using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record UploadDocumentAssetCommand(Guid DocumentId, Guid CommandId, Guid AssetId, string ContentType, byte[] Content);
public sealed record AssetAdded(DocumentAsset Asset) : DocumentEvent;
public sealed record DocumentAssetContent(DocumentAsset Asset, byte[] Content);
public interface IDocumentAssetStore
{
    Task<byte[]?> ReadAssetContentAsync(Guid documentId, DocumentAsset asset, CancellationToken cancellationToken = default);
}
public sealed record DocumentAssetsResponse(Guid DocumentId, long Revision, IReadOnlyList<DocumentAsset> Assets);
public sealed record DocumentAssetsResult(string Code, DocumentAssetsResponse? Response = null);
public sealed record DocumentAssetReadResult(string Code, long? Revision = null, DocumentAssetContent? Content = null);
public interface IDocumentAssets
{
    Task<DocumentAssetsResult> ListAsync(Guid documentId, DocumentActor actor, long? revision = null, Guid? versionId = null, CancellationToken cancellationToken = default);
    Task<DocumentAssetReadResult> ReadAsync(Guid documentId, Guid assetId, DocumentActor actor, long? revision = null, Guid? versionId = null, CancellationToken cancellationToken = default);
}

public sealed class DocumentAssets(IDocumentAuthorization authorization, IDocumentStateReader reader,
    IDocumentVersionStore versions, IDocumentAssetStore store) : IDocumentAssets
{
    public async Task<DocumentAssetsResult> ListAsync(Guid documentId, DocumentActor actor, long? revision = null, Guid? versionId = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || versionId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (revision is not null && versionId is not null) return new("INVALID_QUERY");
        DocumentState? state;
        if (versionId is { } version)
        {
            var saved = await versions.ReadVersionAsync(documentId, version, cancellationToken);
            if (saved.Version is null) return new(saved.Code);
            state = saved.Version.Snapshot;
        }
        else
        {
            var current = await reader.ReadAsync(documentId, revision, cancellationToken);
            if (current.State is null) return new(current.Code);
            state = current.State;
        }
        return new("OK", new(documentId, state.Revision, state.Document.Assets));
    }

    public async Task<DocumentAssetReadResult> ReadAsync(Guid documentId, Guid assetId, DocumentActor actor, long? revision = null, Guid? versionId = null, CancellationToken cancellationToken = default)
    {
        var manifest = await ListAsync(documentId, actor, revision, versionId, cancellationToken);
        if (manifest.Response is not { } response) return new(manifest.Code);
        if (assetId == Guid.Empty) return new("INVALID_ID");
        var asset = response.Assets.FirstOrDefault(a => a.Id == assetId);
        if (asset is null) return new("ASSET_NOT_FOUND");
        var content = await store.ReadAssetContentAsync(documentId, asset, cancellationToken);
        return content is null ? new("ASSET_CONTENT_UNAVAILABLE") : new("OK", response.Revision, new(asset, content));
    }
}

public sealed partial class DocumentCommandHandler
{
    public async Task<CommandResult> HandleAsync(UploadDocumentAssetCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command); ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.AssetId] : null) { Source = actor.Source };
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        // Bound allocation even for internal clients. Freeze bytes before asynchronous execution.
        var content = command.Content is { Length: <= DocumentAssetValidator.MaxAssetBytes } ? command.Content.ToArray() : null;
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.AssetId == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (content is null) return new(Result(command.Content is null ? "INVALID_ASSET" : "ASSET_TOO_LARGE"), null);
            if (DocumentAssetContentFormat.Inspect(command.AssetId, command.ContentType, content) is not { } asset) return new(Result("INVALID_ASSET"), null);
            var document = state.Document with { Assets = [.. state.Document.Assets, asset] };
            if (!DocumentAssetValidator.IsValid(document.Assets)) return new(Result(state.Document.Assets.Any(a => a.Id == asset.Id) ? "DUPLICATE_ID" : "ASSET_LIMIT_EXCEEDED"), null);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : "INVALID_ASSET_MANIFEST"), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new AssetAdded(asset), AssetContent: new(asset, content));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}
