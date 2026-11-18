using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

public sealed partial class DocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(AddCsvDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetAsync(command.DocumentId, command.CommandId, command.DatasetId, command.Name, command.Csv, null, actor, cancellationToken, csv: true);
    }

    public Task<CommandResult> HandleAsync(ReplaceDatasetFixtureFromCsvCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetAsync(command.DocumentId, command.CommandId, command.DatasetId, null, command.Csv, command.ExpectedRevision, actor, cancellationToken, csv: true);
    }

    public Task<CommandResult> HandleAsync(AddDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetAsync(command.DocumentId, command.CommandId, command.DatasetId, command.Name, command.FixtureJson, null, actor, cancellationToken);
    }

    public Task<CommandResult> HandleAsync(ReplaceDatasetFixtureCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeDatasetAsync(command.DocumentId, command.CommandId, command.DatasetId, null, command.FixtureJson, command.ExpectedRevision, actor, cancellationToken);
    }

    private async Task<CommandResult> ChangeDatasetAsync(Guid documentId, Guid commandId, Guid datasetId, string? name,
        string fixtureJson, long? expectedRevision, DocumentActor actor, CancellationToken ct, bool csv = false)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(documentId, commandId, code, revision, actor.Id, null,
            DateTimeOffset.UtcNow, AffectedIds: code == "ACCEPTED" ? [datasetId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty || datasetId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            var existing = document.Datasets.FirstOrDefault(d => d.Id == datasetId);
            if (expectedRevision is not null)
            {
                if (expectedRevision < 0) return new(Result("INVALID_REVISION"), null);
                if (existing is null) return new(Result("DATASET_NOT_FOUND"), null);
                if (expectedRevision != state.Revision) return new(Result("REVISION_CONFLICT"), null);
            }
            else
            {
                if (existing is not null || document.Scenarios.Any(s => s.Id == datasetId) || document.Id == datasetId || document.Pages.Any(p => p.Id == datasetId) ||
                    document.Screens.Any(s => s.Id == datasetId || s.Variants.Any(v => v.Id == datasetId)) || document.Nodes.Any(n => n.Id == datasetId) || document.Tokens.Any(t => t.Id == datasetId) ||
                    document.ComponentDefinitions.Any(d => d.Id == datasetId || d.Parameters.Any(p => p.Id == datasetId) || d.Slots.Any(s => s.Id == datasetId) || d.Variants.Any(v => v.Id == datasetId)))
                    return new(Result("DUPLICATE_ID"), null);
                if (!DatasetValidator.IsValidName(name)) return new(Result("INVALID_DATASET"), null);
            }
            if (csv && !CsvDatasetImporter.TryConvert(fixtureJson, out fixtureJson)) return new(Result("INVALID_CSV_FIXTURE"), null);
            if (!DatasetValidator.IsValidFixture(fixtureJson)) return new(Result("INVALID_DATASET_FIXTURE"), null);
            var dataset = new DocumentDataset(datasetId, existing?.Name ?? name!, fixtureJson, existing?.ConnectorId);
            var changed = document with { Datasets = expectedRevision is null ? [.. document.Datasets, dataset] : document.Datasets.Select(d => d.Id == datasetId ? dataset : d).ToArray() };
            if (!DatasetValidator.IsValid(changed.Datasets)) return new(Result("DATASET_LIMIT_EXCEEDED"), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, expectedRevision is null ? new DatasetAdded(dataset) : new DatasetFixtureReplaced(datasetId, fixtureJson));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }
    public async Task<CommandResult> HandleAsync(DeleteDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId, command.CommandId, code, revision, actor.Id, null,
            DateTimeOffset.UtcNow, AffectedIds: code == "ACCEPTED" ? [command.DatasetId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.DatasetId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.ExpectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            if (!state.Document.Datasets.Any(d => d.Id == command.DatasetId)) return new(Result("DATASET_NOT_FOUND"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            if (state.Document.Nodes.Any(n => n.Repeater?.DatasetId == command.DatasetId || n.DataBindings.Values.Any(b => b.DatasetId == command.DatasetId))) return new(Result("DATASET_IN_USE"), null);
            if (state.Document.Scenarios.Any(s => s.Actions.OfType<FigVam.Domain.Preview.SelectDataset>().Any(a => a.DatasetId == command.DatasetId))) return new(Result("SCENARIO_IN_USE"), null);
            var next = new DocumentState(state.Document with { Datasets = state.Document.Datasets.Where(d => d.Id != command.DatasetId).ToArray() }, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new DatasetDeleted(command.DatasetId));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
}
