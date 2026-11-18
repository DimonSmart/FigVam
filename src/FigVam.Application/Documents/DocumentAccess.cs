namespace FigVam.Application.Documents;

public sealed record CreateDocumentCommand(Guid DocumentId, string Name = "Document");

public enum DocumentRole { Owner, Editor, Viewer }
public sealed record DocumentAccessResult(string Code, Guid DocumentId)
{
    public bool Accepted => Code == "ACCEPTED";
}

// actor is supplied by authenticated server code, separately from operation payloads.
public interface IDocumentAccessService
{
    Task<DocumentAccessResult> CreateAsync(CreateDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<DocumentAccessResult> SetMemberAsync(Guid documentId, string memberId, DocumentRole role,
        DocumentActor actor, CancellationToken cancellationToken = default);
    Task<DocumentAccessResult> RemoveMemberAsync(Guid documentId, string memberId,
        DocumentActor actor, CancellationToken cancellationToken = default);
}
