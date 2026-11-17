using System.Text;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed record DatasetSummary(Guid Id, string Name, int FixtureBytes);
public sealed record DatasetListResponse(Guid DocumentId, long Revision, IReadOnlyList<DatasetSummary> Items, int Offset, int Limit, int Total);
public sealed record DatasetResponse(Guid DocumentId, long Revision, DatasetSummary Dataset);
public sealed record DatasetFixtureResponse(Guid DocumentId, long Revision, Guid DatasetId, string FixtureJson);
public sealed record DatasetQueryResult<T>(string Code, T? Response = default) where T : class;

public interface IDocumentDatasetQueries
{
    Task<DatasetQueryResult<DatasetListResponse>> ListAsync(Guid documentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
    Task<DatasetQueryResult<DatasetResponse>> ReadAsync(Guid documentId, Guid datasetId, long? revision, DocumentActor actor, CancellationToken ct = default);
    Task<DatasetQueryResult<DatasetFixtureResponse>> ReadFixtureAsync(Guid documentId, Guid datasetId, long? revision, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentDatasetQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentDatasetQueries
{
    private async Task<DocumentStateReadResult> StateAsync(Guid documentId, Guid? datasetId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(actor);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || datasetId == Guid.Empty) return new("INVALID_ID");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        if (revision < 0) return new("INVALID_REVISION");
        return await reader.ReadAsync(documentId, revision, ct);
    }

    private static DatasetSummary Summary(DocumentDataset dataset) => new(dataset.Id, dataset.Name, Encoding.UTF8.GetByteCount(dataset.FixtureJson));

    public async Task<DatasetQueryResult<DatasetListResponse>> ListAsync(Guid documentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, null, revision, offset, limit, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var datasets = state.Document.Datasets.OrderBy(d => d.Id).ToArray();
        return new("OK", new(documentId, state.Revision, datasets.Skip(offset).Take(limit).Select(Summary).ToArray(), offset, limit, datasets.Length));
    }

    public async Task<DatasetQueryResult<DatasetResponse>> ReadAsync(Guid documentId, Guid datasetId, long? revision, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, datasetId, revision, 0, 1, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var dataset = state.Document.Datasets.FirstOrDefault(d => d.Id == datasetId);
        return dataset is null ? new("DATASET_NOT_FOUND") : new("OK", new(documentId, state.Revision, Summary(dataset)));
    }

    public async Task<DatasetQueryResult<DatasetFixtureResponse>> ReadFixtureAsync(Guid documentId, Guid datasetId, long? revision, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, datasetId, revision, 0, 1, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var dataset = state.Document.Datasets.FirstOrDefault(d => d.Id == datasetId);
        return dataset is null ? new("DATASET_NOT_FOUND") : new("OK", new(documentId, state.Revision, datasetId, dataset.FixtureJson));
    }
}
