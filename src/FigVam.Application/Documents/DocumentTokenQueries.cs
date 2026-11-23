using FigVam.Domain.Documents;
using FigVam.Domain.Components;
using FigVam.Domain.Tokens;

namespace FigVam.Application.Documents;

public sealed record TokenListResponse(Guid DocumentId, long Revision, IReadOnlyList<DesignToken> Items, int Offset, int Limit, int Total);
public sealed record TokenResponse(Guid DocumentId, long Revision, DesignToken Token);
public sealed record TokenUsage(string Kind, Guid OwnerId, string? Property, TokenTheme? Theme, Guid? ParameterId,
    bool Indirect = false, IReadOnlyList<Guid>? Chain = null, string? Label = null);
public sealed record TokenUsagesResponse(Guid DocumentId, long Revision, Guid TokenId, IReadOnlyList<TokenUsage> Items, int Offset, int Limit, int Total);
public sealed record TokenQueryResult<T>(string Code, T? Response = default) where T : class;

public interface IDocumentTokenQueries
{
    Task<TokenQueryResult<TokenListResponse>> ListAsync(Guid documentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
    Task<TokenQueryResult<TokenResponse>> ReadAsync(Guid documentId, Guid tokenId, long? revision, DocumentActor actor, CancellationToken ct = default);
    Task<TokenQueryResult<TokenUsagesResponse>> UsagesAsync(Guid documentId, Guid tokenId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default);
}

public sealed class DocumentTokenQueries(IDocumentAuthorization authorization, IDocumentStateReader reader) : IDocumentTokenQueries
{
    private async Task<DocumentStateReadResult> StateAsync(Guid documentId, Guid? tokenId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanReadAsync(actor, documentId, ct)) return new("FORBIDDEN");
        if (documentId == Guid.Empty || tokenId == Guid.Empty) return new("INVALID_ID");
        if (offset < 0 || limit is < 1 or > 100) return new("INVALID_QUERY");
        if (revision < 0) return new("INVALID_REVISION");
        return await reader.ReadAsync(documentId, revision, ct);
    }
    public async Task<TokenQueryResult<TokenListResponse>> ListAsync(Guid documentId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, null, revision, offset, limit, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var tokens = state.Document.Tokens.OrderBy(t => t.Id).ToArray();
        return new("OK", new(documentId, state.Revision, tokens.Skip(offset).Take(limit).ToArray(), offset, limit, tokens.Length));
    }
    public async Task<TokenQueryResult<TokenResponse>> ReadAsync(Guid documentId, Guid tokenId, long? revision, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, tokenId, revision, 0, 1, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        var token = state.Document.Tokens.FirstOrDefault(t => t.Id == tokenId);
        return token is null ? new("TOKEN_NOT_FOUND") : new("OK", new(documentId, state.Revision, token));
    }
    public async Task<TokenQueryResult<TokenUsagesResponse>> UsagesAsync(Guid documentId, Guid tokenId, long? revision, int offset, int limit, DocumentActor actor, CancellationToken ct = default)
    {
        var read = await StateAsync(documentId, tokenId, revision, offset, limit, actor, ct);
        if (read.State is not { } state) return new(read.Code);
        if (!state.Document.Tokens.Any(t => t.Id == tokenId)) return new("TOKEN_NOT_FOUND");
        var usages = new DesignResourceDependencies(state.Document).Usages("token", tokenId)
            .Select(x => new TokenUsage(x.Kind, x.OwnerId, x.Property, x.Theme, x.ParameterId,
                x.Indirect, x.Chain, x.Label)).ToArray();
        return new("OK", new(documentId, state.Revision, tokenId, usages.Skip(offset).Take(limit).ToArray(), offset, limit, usages.Length));
    }
}
