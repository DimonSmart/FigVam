using System.Text;
using System.Text.Json;
using FigVam.Application.Connectors;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public enum PreviewDataStatus { Ready, Loading, Error, Empty }
public enum PreviewDataSource { Fixture, Remote }
public sealed record PreviewDatasetState(Guid DatasetId, PreviewDataStatus Status, PreviewDataSource Source,
    RemoteJsonStatus? RemoteError = null);
public sealed record PreviewDataResult(string Code, PreviewDatasetState? State = null);
public sealed record PreviewBindingResult(string Code, NodeDataResult? Evaluation = null);
public sealed record PreviewRepeaterResult(string Code, NodeRepeaterResult? Evaluation = null);

// A server-side, ephemeral capability. Payloads never enter Preview history or document state.
public sealed class DocumentPreviewData
{
    private sealed record Entry(PreviewDatasetState State, JsonElement? Remote = null, int Bytes = 0);
    private readonly DocumentStructure document;
    private readonly IDocumentAuthorization authorization;
    private readonly INodeProfile profile;
    private readonly IRemoteJsonReader reader;
    private readonly object gate = new();
    private readonly Dictionary<Guid, Entry> entries = [];

    internal DocumentPreviewData(DocumentStructure document, IDocumentAuthorization authorization, INodeProfile profile, IRemoteJsonReader reader)
    {
        // Detach mutable collection implementations supplied by a state reader.
        this.document = JsonSerializer.Deserialize<DocumentStructure>(JsonSerializer.Serialize(document))!;
        this.authorization = authorization;
        this.profile = profile;
        this.reader = reader;
    }

    private async Task<bool> Allowed(DocumentActor actor, CancellationToken ct)
        => !string.IsNullOrWhiteSpace(actor.Id) && await authorization.CanReadAsync(actor, document.Id, ct);

    public async Task<PreviewDataResult> GetStateAsync(Guid datasetId, DocumentActor actor, CancellationToken ct = default)
    {
        if (!await Allowed(actor, ct)) return new("FORBIDDEN");
        if (Dataset(datasetId) is not { } dataset) return new("DATASET_NOT_FOUND");
        lock (gate) return new("OK", EntryFor(dataset).State);
    }

    public async Task<PreviewDataResult> UseFixtureAsync(Guid datasetId, DocumentActor actor, CancellationToken ct = default)
    {
        if (!await Allowed(actor, ct)) return new("FORBIDDEN");
        if (Dataset(datasetId) is not { } dataset) return new("DATASET_NOT_FOUND");
        lock (gate)
        {
            if (EntryFor(dataset).State.Status == PreviewDataStatus.Loading) return new("BUSY");
            entries.Remove(datasetId);
            return new("OK", EntryFor(dataset).State);
        }
    }

    public async Task<PreviewDataResult> RefreshAsync(Guid datasetId, DocumentActor actor, CancellationToken ct = default)
    {
        if (!await Allowed(actor, ct)) return new("FORBIDDEN");
        if (Dataset(datasetId) is not { } dataset) return new("DATASET_NOT_FOUND");
        if (dataset.ConnectorId is not { } connectorId) return new("CONNECTOR_NOT_CONFIGURED");
        lock (gate)
        {
            if (EntryFor(dataset).State.Status == PreviewDataStatus.Loading) return new("BUSY");
            entries[datasetId] = new(new(datasetId, PreviewDataStatus.Loading, PreviewDataSource.Fixture));
        }
        RemoteJsonResult result;
        try { result = await reader.ReadAsync(connectorId, ct); }
        catch (OperationCanceledException) { result = new(RemoteJsonStatus.Cancelled); }
        catch (Exception) { result = new(RemoteJsonStatus.UpstreamFailure); }
        // Recheck after I/O so a revoked grant cannot release or retain a fetched payload.
        bool allowed;
        try { allowed = await Allowed(actor, CancellationToken.None); }
        catch { lock (gate) entries.Remove(datasetId); throw; }
        lock (gate)
        {
            if (!allowed) { entries.Remove(datasetId); return new("FORBIDDEN"); }
            if (ct.IsCancellationRequested) result = new(RemoteJsonStatus.Cancelled);
            if (result.Status == RemoteJsonStatus.Success)
            {
                if (result.Data is not { } root || root.ValueKind == JsonValueKind.Undefined)
                    result = new(RemoteJsonStatus.InvalidJson);
                else
                {
                    var json = root.GetRawText();
                    var bytes = Encoding.UTF8.GetByteCount(json);
                    if (bytes > DatasetValidator.MaxFixtureBytes || entries.Values.Sum(e => (long)e.Bytes) + bytes > DatasetValidator.MaxDocumentFixtureBytes)
                        result = new(RemoteJsonStatus.ResponseTooLarge);
                    else if (!DatasetValidator.IsValidFixture(json)) result = new(RemoteJsonStatus.InvalidJson);
                    else
                    {
                        var state = new PreviewDatasetState(datasetId, Status(root), PreviewDataSource.Remote);
                        entries[datasetId] = new(state, root.Clone(), bytes);
                        return new("OK", state);
                    }
                }
            }
            var error = new PreviewDatasetState(datasetId, PreviewDataStatus.Error, PreviewDataSource.Fixture, result.Status);
            entries[datasetId] = new(error);
            return new("REMOTE_DATA_ERROR", error);
        }
    }

    public async Task<PreviewBindingResult> EvaluateBindingAsync(Guid nodeId, string property, Guid datasetId,
        DocumentActor actor, CancellationToken ct = default)
    {
        if (!await Allowed(actor, ct)) return new("FORBIDDEN");
        ct.ThrowIfCancellationRequested();
        if (Dataset(datasetId) is not { } dataset) return new("DATASET_NOT_FOUND");
        var node = document.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node is null) return new("NODE_NOT_FOUND");
        if (!node.DataBindings.TryGetValue(property, out var binding)) return new("DATA_BINDING_NOT_FOUND");
        // Selecting data changes the data axis only, while retaining the node's typed path contract.
        var evaluation = NodeDataBindingEvaluator.Evaluate(document, node, property, binding with { DatasetId = datasetId }, profile, Root(dataset));
        ct.ThrowIfCancellationRequested();
        return new("OK", evaluation);
    }

    public async Task<PreviewRepeaterResult> EvaluateRepeaterAsync(Guid nodeId, Guid datasetId, DocumentActor actor, CancellationToken ct = default)
    {
        if (!await Allowed(actor, ct)) return new("FORBIDDEN");
        ct.ThrowIfCancellationRequested();
        if (Dataset(datasetId) is not { } dataset) return new("DATASET_NOT_FOUND");
        var node = document.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node is null) return new("NODE_NOT_FOUND");
        if (node.Repeater is not { } repeater) return new("REPEATER_NOT_FOUND");
        var evaluation = NodeRepeaterEvaluator.Evaluate(document, node, repeater with { DatasetId = datasetId }, profile, Root(dataset));
        ct.ThrowIfCancellationRequested();
        return new("OK", evaluation);
    }

    private DocumentDataset? Dataset(Guid id) => document.Datasets.FirstOrDefault(d => d.Id == id);
    private Entry EntryFor(DocumentDataset dataset)
    {
        if (entries.TryGetValue(dataset.Id, out var entry)) return entry;
        using var json = JsonDocument.Parse(dataset.FixtureJson);
        return new(new(dataset.Id, Status(json.RootElement), PreviewDataSource.Fixture));
    }
    private JsonElement Root(DocumentDataset dataset)
    {
        lock (gate) if (EntryFor(dataset).Remote is { } remote) return remote;
        using var json = JsonDocument.Parse(dataset.FixtureJson);
        return json.RootElement.Clone();
    }
    private static PreviewDataStatus Status(JsonElement root)
        => root.ValueKind == JsonValueKind.Array && root.GetArrayLength() == 0 ? PreviewDataStatus.Empty : PreviewDataStatus.Ready;
}
