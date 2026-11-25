using FigVam.Server.Authentication;
using FigVam.Server.Documents;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Mcp;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/mcp-access")]
public sealed class McpAccessController(McpAccessRegistry registry) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> Status(Guid documentId, CancellationToken ct) => Access(documentId, false, ct);

    [HttpPost]
    public Task<IActionResult> Grant(Guid documentId, CancellationToken ct) => Access(documentId, true, ct);

    [HttpDelete]
    public async Task<IActionResult> Revoke(Guid documentId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var userId = User.GetDocumentActor().Id;
        // A former editor may still revoke their own grant, never another user's.
        await registry.RevokeDirectAsync(documentId, userId, ct);
        return Ok(new { enabled = false, tunnel = TunnelStatus(documentId, userId) });
    }

    [HttpPost("tunnel")]
    public async Task<IActionResult> GrantTunnel(Guid documentId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var userId = User.GetDocumentActor().Id;
        if (!await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, userId, ct))
            return StatusCode(403, ApiErrors.Create(403, "FORBIDDEN"));
        if (!TunnelConfigured()) return StatusCode(503, new { code = "MCP_TUNNEL_NOT_CONFIGURED" });
        var grant = registry.GrantTunnel(documentId, userId);
        if (grant is null) return Conflict(new { code = "MCP_TUNNEL_IN_USE" });
        if (!await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, userId, ct))
        {
            await registry.RevokeAsync(grant, CancellationToken.None);
            return StatusCode(403, ApiErrors.Create(403, "FORBIDDEN"));
        }
        return Ok(TunnelStatus(documentId, userId));
    }

    [HttpDelete("tunnel")]
    public async Task<IActionResult> RevokeTunnel(Guid documentId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        await registry.RevokeTunnelAsync(documentId, User.GetDocumentActor().Id, ct);
        return Ok(TunnelStatus(documentId, User.GetDocumentActor().Id));
    }

    private bool TunnelConfigured() =>
        HttpContext.RequestServices.GetRequiredService<McpTunnelCredential>().Enabled &&
        McpServiceRegistration.PublicEndpoint(HttpContext.RequestServices) is not null;

    private object TunnelStatus(Guid documentId, string userId)
    {
        var configured = TunnelConfigured();
        var grant = configured ? registry.GetTunnelGrant() : null;
        var enabled = grant is not null && grant.DocumentId == documentId && grant.UserId == userId;
        return new { configured, enabled, occupied = grant is not null && !enabled };
    }

    private async Task<IActionResult> Access(Guid documentId, bool create, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var userId = User.GetDocumentActor().Id;
        if (!await McpServiceRegistration.CanEditAsync(HttpContext.RequestServices, documentId, userId, ct))
        {
            await registry.RevokeAsync(documentId, userId, ct);
            return StatusCode(403, ApiErrors.Create(403, "FORBIDDEN"));
        }

        var endpoint = McpServiceRegistration.PublicEndpoint(HttpContext.RequestServices);
        if (endpoint is null) return StatusCode(503, new { code = "MCP_ENDPOINT_NOT_CONFIGURED" });

        var grant = create ? registry.Grant(documentId, userId) : registry.GetStatus(documentId, userId);
        var tunnel = TunnelStatus(documentId, userId);
        if (grant is null) return Ok(new { enabled = false, tunnel });
        return Ok(new { enabled = true, endpoint = endpoint.AbsoluteUri, token = grant.Token, createdAt = grant.CreatedAt, tunnel });
    }
}
