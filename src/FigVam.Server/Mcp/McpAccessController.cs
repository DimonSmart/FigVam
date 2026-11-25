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
        await registry.RevokeAsync(documentId, userId, ct);
        return Ok(new { enabled = false });
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
        if (grant is null) return Ok(new { enabled = false });
        return Ok(new { enabled = true, endpoint = endpoint.AbsoluteUri, token = grant.Token, createdAt = grant.CreatedAt });
    }
}
