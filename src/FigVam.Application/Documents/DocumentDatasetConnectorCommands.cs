using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(SetDatasetConnectorCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetConnectorAsync(command.DocumentId, command.CommandId, command.DatasetId, command.ExpectedRevision, command.ConnectorId, false, actor, cancellationToken);
    }

    public Task<CommandResult> HandleAsync(RemoveDatasetConnectorCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetConnectorAsync(command.DocumentId, command.CommandId, command.DatasetId, command.ExpectedRevision, null, true, actor, cancellationToken);
    }

    private async Task<CommandResult> ChangeDatasetConnectorAsync(Guid documentId, Guid commandId, Guid datasetId, long expectedRevision,
        string? connectorId, bool remove, DocumentActor actor, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(documentId, commandId, code, revision, actor.Id, null,
            DateTimeOffset.UtcNow, AffectedIds: code == "ACCEPTED" ? [datasetId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty || datasetId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (expectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            var dataset = state.Document.Datasets.FirstOrDefault(d => d.Id == datasetId);
            if (dataset is null) return new(Result("DATASET_NOT_FOUND"), null);
            if (expectedRevision != state.Revision) return new(Result("REVISION_CONFLICT"), null);
            if (!remove && (!DatasetValidator.IsValidConnectorId(connectorId) || connectors?.IsAllowed(connectorId!) != true))
                return new(Result("CONNECTOR_NOT_ALLOWED"), null);
            if (remove && dataset.ConnectorId is null) return new(Result("DATASET_CONNECTOR_NOT_FOUND"), null);
            var next = new DocumentState(state.Document with
            {
                Datasets = state.Document.Datasets.Select(d => d.Id == datasetId ? d with { ConnectorId = connectorId } : d).ToArray()
            }, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new DatasetConnectorSet(datasetId, connectorId));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }
}
