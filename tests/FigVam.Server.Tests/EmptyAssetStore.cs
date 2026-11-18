using FigVam.Application.Documents;
using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

internal sealed class EmptyAssetStore : IDocumentAssetStore
{
    public Task<byte[]?> ReadAssetContentAsync(Guid documentId, DocumentAsset asset, CancellationToken cancellationToken = default)
        => throw new InvalidOperationException("Asset content was not expected.");
}
