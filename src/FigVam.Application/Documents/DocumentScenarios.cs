using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Application.Documents;

public sealed record CreateScenarioCommand(Guid DocumentId, Guid CommandId, PreviewScenario Scenario, long? ExpectedRevision = null);
public sealed record UpdateScenarioCommand(Guid DocumentId, Guid CommandId, PreviewScenario Scenario, long ExpectedRevision);
public sealed record DeleteScenarioCommand(Guid DocumentId, Guid CommandId, Guid ScenarioId, long ExpectedRevision);
public sealed record ScenarioChanged(Guid ScenarioId, PreviewScenario? Scenario, string Operation) : DocumentEvent;

public sealed partial class DocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(CreateScenarioCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScenario(c.DocumentId, c.CommandId, c.Scenario?.Id ?? Guid.Empty, c.Scenario, c.ExpectedRevision, "CREATE_SCENARIO", actor, cancellationToken);
    public Task<CommandResult> HandleAsync(UpdateScenarioCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScenario(c.DocumentId, c.CommandId, c.Scenario?.Id ?? Guid.Empty, c.Scenario, c.ExpectedRevision, "UPDATE_SCENARIO", actor, cancellationToken);
    public Task<CommandResult> HandleAsync(DeleteScenarioCommand c, DocumentActor actor, CancellationToken cancellationToken = default)
        => ChangeScenario(c.DocumentId, c.CommandId, c.ScenarioId, null, c.ExpectedRevision, "DELETE_SCENARIO", actor, cancellationToken);

    private async Task<CommandResult> ChangeScenario(Guid documentId, Guid commandId, Guid id, PreviewScenario? scenario, long? expectedRevision, string operation, DocumentActor actor, CancellationToken ct)
    {
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(documentId, commandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation, AffectedIds: code == "ACCEPTED" ? [id] : null);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (id == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (expectedRevision is < 0) return new(Result("INVALID_REVISION"), null);
            if (expectedRevision is not null && expectedRevision != state.Revision) return new(Result("REVISION_CONFLICT"), null);
            var exists = state.Document.Scenarios.Any(s => s.Id == id);
            if (operation == "CREATE_SCENARIO" && exists) return new(Result("DUPLICATE_ID"), null);
            if (operation != "CREATE_SCENARIO" && !exists) return new(Result("SCENARIO_NOT_FOUND"), null);
            var changed = DocumentScenarioEditor.Set(state.Document, id, scenario);
            if (DocumentStructureValidator.Validate(changed, profile).FirstOrDefault() is { } invalid)
                return new(Result(invalid.Code == "duplicate-id" ? "DUPLICATE_ID" : invalid.Code, explanation: invalid.Message), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ScenarioChanged(id, scenario, operation));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }
}

public sealed record ScenariosResponse(Guid DocumentId, long Revision, IReadOnlyList<PreviewScenario> Items, int Offset, int Limit, int Total);
public sealed record ScenariosResult(string Code, ScenariosResponse? Response = null);
public interface IDocumentScenarioQueries
{
    Task<ScenariosResult> ReadAsync(Guid documentId, Guid? screenId, Guid? scenarioId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}
public sealed class DocumentScenarioQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentScenarioQueries
{
    public async Task<ScenariosResult> ReadAsync(Guid documentId, Guid? screenId, Guid? scenarioId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || screenId == Guid.Empty || scenarioId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        var read = await reader.ReadAsync(documentId, revision, ct);
        if (read.State is not { } state) return new(read.Code);
        if (screenId is not null && !state.Document.Screens.Any(s => s.Id == screenId)) return new("SCREEN_NOT_FOUND");
        var items = state.Document.Scenarios.Where(s => (screenId is null || s.ScreenId == screenId) && (scenarioId is null || s.Id == scenarioId)).ToArray();
        if (scenarioId is not null && items.Length == 0) return new("SCENARIO_NOT_FOUND");
        return new("OK", new(documentId, state.Revision, items.Skip(offset).Take(limit).ToArray(), offset, limit, items.Length));
    }
}
