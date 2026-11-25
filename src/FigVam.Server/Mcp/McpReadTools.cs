using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;
using FigVam.Application.Documents;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

[McpServerToolType]
public sealed class McpReadTools(IHttpContextAccessor accessor, IDocumentStructureQueries queries,
    IDocumentTokenQueries tokens, IDocumentScenarioQueries scenarios)
{
    private McpDocumentGrant Grant => (McpDocumentGrant)accessor.HttpContext!.Items[McpServiceRegistration.GrantKey]!;
    private DocumentActor Actor => new(Grant.UserId);

    internal static CallToolResult Result(string code, object? response)
    {
        var failed = response is null;
        var value = JsonSerializer.SerializeToElement(response ?? new { status = "REJECTED", code, message = "The document operation was rejected." },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull });
        if (value.GetRawText().Length > 256 * 1024)
            {
            var small = JsonSerializer.SerializeToElement(new { status = "REJECTED", code = "RESULT_TOO_LARGE", message = "Request a smaller page." });
            return new CallToolResult { Content = [new TextContentBlock { Text = small.GetRawText() }], StructuredContent = small, IsError = true };
        }
        return new CallToolResult { Content = [new TextContentBlock { Text = value.GetRawText() }], StructuredContent = value, IsError = failed };
    }

    private async Task<CallToolResult> Read(StructureQuery query, CancellationToken ct)
    {
        var r = await queries.QueryAsync(Grant.DocumentId, query, Actor, ct);
        return Result(r.Code, r.Response);
    }

    [McpServerTool(Name = "get_document"), Description("Read document name, revision and first pages. Use list_pages for more.")]
    public Task<CallToolResult> GetDocument(CancellationToken ct) =>
        Read(new("document", Depth: 1, Fields: "name,childCount"), ct);

    [McpServerTool(Name = "list_pages"), Description("List pages at a document revision.")]
    public Task<CallToolResult> ListPages(int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default) =>
        Read(new("pages", Offset: offset, Limit: limit, Fields: "name,childCount", Revision: revision), ct);

    [McpServerTool(Name = "list_screens"), Description("List screens on the specified page.")]
    public Task<CallToolResult> ListScreens(Guid pageId, int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default) =>
        Read(new("page-screens", pageId, offset, limit, Fields: "name,dimensions,childCount", Revision: revision), ct);

    [McpServerTool(Name = "get_screen"), Description("Read screen dimensions and root nodes.")]
    public Task<CallToolResult> GetScreen(Guid screenId, long? revision = null, CancellationToken ct = default) =>
        Read(new("screen", screenId, Depth: 1, Fields: "name,dimensions,kind,childCount,parentId", Revision: revision), ct);

    [McpServerTool(Name = "get_node"), Description("Read node kind, properties and child IDs.")]
    public Task<CallToolResult> GetNode(Guid nodeId, long? revision = null, CancellationToken ct = default) =>
        Read(new("node", nodeId, Depth: 1, Fields: "name,kind,properties,childCount,parentId", Revision: revision), ct);

    [McpServerTool(Name = "list_children"), Description("List ordered children of a screen or container.")]
    public Task<CallToolResult> ListChildren(Guid parentId, int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default) =>
        Read(new("children", parentId, offset, limit, Fields: "name,kind,childCount,parentId", Revision: revision), ct);

    [McpServerTool(Name = "get_screen_tree"), Description("Read a paginated flat list of screen descendants with parent IDs.")]
    public Task<CallToolResult> GetScreenTree(Guid screenId, int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default) =>
        Read(new("nodes", Offset: offset, Limit: limit, Fields: "name,kind,childCount,parentId", ScreenId: screenId, Revision: revision), ct);

    [McpServerTool(Name = "list_node_types"), Description("List node kinds supported by the document profile.")]
    public async Task<CallToolResult> ListNodeTypes(CancellationToken ct)
    {
        var r = await queries.ReadProfileAsync(Grant.DocumentId, null, Actor, ct);
        return Result(r.Code, r.Response is null ? null : new { r.Response.Revision, kinds = r.Response.Kinds.Select(k => k.Kind) });
    }

    [McpServerTool(Name = "get_node_schema"), Description("Read the supported properties and constraints for a node kind.")]
    public async Task<CallToolResult> GetNodeSchema(string kind, CancellationToken ct)
    {
        var r = await queries.ReadProfileAsync(Grant.DocumentId, null, Actor, ct);
        if (r.Response is null) return Result(r.Code, null);
        var definition = r.Response.Kinds.FirstOrDefault(k => k.Kind == kind);
        return Result(definition is null ? "UNSUPPORTED_NODE_KIND" : "OK", definition);
    }

    [McpServerTool(Name = "list_tokens"), Description("List design tokens and Light/Dark values.")]
    public async Task<CallToolResult> ListTokens(int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default)
    {
        var r = await tokens.ListAsync(Grant.DocumentId, revision, offset, limit, Actor, ct);
        return Result(r.Code, r.Response);
    }

    [McpServerTool(Name = "list_scenarios"), Description("List interactive scenarios on a screen.")]
    public async Task<CallToolResult> ListScenarios(Guid screenId, int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default)
    {
        var r = await scenarios.ReadAsync(Grant.DocumentId, screenId, null, revision, offset, limit, Actor, ct);
        return Result(r.Code, r.Response);
    }

    [McpServerTool(Name = "get_screen_layout"), Description("Read computed bounds and layout diagnostics.")]
    public async Task<CallToolResult> GetScreenLayout(Guid screenId, int offset = 0, int limit = 50, long? revision = null, CancellationToken ct = default)
    {
        var r = await queries.ReadScreenLayoutAsync(Grant.DocumentId, new(screenId, revision, offset, limit), Actor, ct);
        return Result(r.Code, r.Response);
    }
}
