using FigVam.Application.Connectors;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;

namespace FigVam.Application.Documents;

public sealed record DocumentPreview(Guid DocumentId, long Revision, PreviewSession Session,
    [property: System.Text.Json.Serialization.JsonIgnore] DocumentPreviewData Data);
public sealed record DocumentPreviewResult(string Code, DocumentPreview? Preview = null,
    IReadOnlyList<StructureError>? DocumentDiagnostics = null, IReadOnlyList<PreviewDiagnostic>? PreviewDiagnostics = null);
public sealed record PreviewTrigger(Guid NodeId, PreviewEvent Event);

public interface IDocumentPreviewFactory
{
    Task<DocumentPreviewResult> CreateAsync(Guid documentId, long? revision, PreviewSelection selection,
        DocumentActor actor, CancellationToken cancellationToken = default);
    Task<DocumentPreviewResult> ReplayAsync(Guid documentId, long revision, PreviewSelection selection, IReadOnlyList<PreviewTrigger> triggers,
        DocumentActor actor, CancellationToken cancellationToken = default);
}

public sealed class DocumentPreviewFactory(IDocumentAuthorization authorization, IDocumentStateReader reader, INodeProfile profile, IRemoteJsonReader remoteReader) : IDocumentPreviewFactory
{
    public async Task<DocumentPreviewResult> ReplayAsync(Guid documentId, long revision, PreviewSelection selection,
        IReadOnlyList<PreviewTrigger> triggers, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (selection is null || triggers is null || triggers.Count > 128 ||
            triggers.Any(trigger => trigger is null || trigger.NodeId == Guid.Empty || !Enum.IsDefined(trigger.Event)))
            return new("INVALID_PREVIEW_REQUEST");
        var result = await CreateAsync(documentId, revision, selection, actor, cancellationToken);
        if (result.Preview is not { } preview)
            return result;
        var session = preview.Session;
        try
        {
            foreach (var trigger in triggers)
            {
                cancellationToken.ThrowIfCancellationRequested();
                session = session.Trigger(trigger.NodeId, trigger.Event);
                if (session.Overlays.Count > 32) return new("PREVIEW_OVERLAY_LIMIT");
            }
        }
        catch (InvalidOperationException)
        {
            return new("INVALID_PREVIEW_EVENT");
        }
        return result with { Preview = preview with { Session = session } };
    }

    public async Task<DocumentPreviewResult> CreateAsync(Guid documentId, long? revision, PreviewSelection selection,
        DocumentActor actor, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, cancellationToken)) return new("FORBIDDEN");
        if (documentId == Guid.Empty) return new("INVALID_ID");
        if (revision < 0) return new("INVALID_REVISION");
        // One read supplies both the revision and every reference used by the session.
        var read = await reader.ReadAsync(documentId, revision, cancellationToken);
        if (read.State is not { } state) return new(read.Code);
        var document = state.Document;
        var errors = DocumentStructureValidator.Validate(document, profile);
        if (errors.Count > 0) return new("INVALID_DOCUMENT", DocumentDiagnostics: errors);
        var nodes = document.Nodes.ToDictionary(n => n.Id);
        PreviewScreen Screen(ScreenStructure screen)
        {
            var members = new List<Guid>();
            var pending = new Stack<Guid>(screen.ChildIds.Reverse());
            while (pending.TryPop(out var id))
            {
                members.Add(id);
                foreach (var child in nodes[id].ChildIds.Reverse()) pending.Push(child);
            }
            return new(screen.Id, members);
        }
        var definition = new PreviewDefinition(document.Screens.Select(Screen).ToArray(),
            document.Screens.SelectMany(s => s.Variants.Select(v => new PreviewVariant(v.Id, s.Id))).ToArray(),
            document.Datasets.Select(d => d.Id).ToArray(), document.Scenarios, selection);
        var diagnostics = PreviewValidator.Validate(definition);
        if (diagnostics.Count > 0) return new("INVALID_PREVIEW", PreviewDiagnostics: diagnostics);
        return new("OK", new(documentId, state.Revision, PreviewSession.Start(definition),
            new(document, authorization, PortableUiProfileResolver.Require(document.Profile, profile), remoteReader)));
    }
}
