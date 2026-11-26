using System.ComponentModel;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

[McpServerToolType]
public sealed class McpWriteTools(IHttpContextAccessor accessor, IDocumentCommandHandler handler,
    IDocumentStateReader reader, INodeProfile profile, IDocumentCommandResultReader results)
{
    private McpDocumentGrant Grant => (McpDocumentGrant)accessor.HttpContext!.Items[McpServiceRegistration.GrantKey]!;
    private Guid DocumentId => Grant.DocumentId;
    private DocumentActor Actor => new(Grant.UserId) { Source = "MCP" };

    private static CallToolResult Error(string code, string message, Guid? commandId = null, long? revision = null,
        string? property = null, string? expected = null, string? actual = null)
    {
        var json = JsonSerializer.SerializeToElement(new { status = "REJECTED", code, message, commandId, revision, property, expected, actual },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
        return new CallToolResult { IsError = true, StructuredContent = json, Content = [new TextContentBlock { Text = json.GetRawText() }] };
    }

    private static CallToolResult Result(CommandResult result, string? affected = null)
    {
        if (!result.Accepted)
        {
            var message = result.Explanation ?? "The command was rejected.";
            if (result.PropertyPath is { } path) message = $"Property '{path}': {message}";
            return Error(result.Code, message, result.CommandId, result.Revision,
                result.PropertyPath ?? result.Property, result.Expected, result.Actual);
        }
        var data = new Dictionary<string, object?> { ["status"] = result.Code, ["revision"] = result.Revision, ["commandId"] = result.CommandId };
        if (result.PageId is { } page) data["pageId"] = page;
        if (result.ScreenId is { } screen) data["screenId"] = screen;
        if (result.NodeId is { } node) data["nodeId"] = node;
        if (result.VersionId is { } version) data["versionId"] = version;
        if (affected is not null && result.AffectedIds is { Count: > 0 }) data[affected] = result.AffectedIds[0];
        return McpReadTools.Result(result.Code, data);
    }

    private async Task<CallToolResult> Run(Guid? commandId, Func<Guid, Task<CommandResult>> action, string? affected = null)
    {
        var id = commandId ?? Guid.NewGuid();
        try
        {
            if (commandId is not null && await results.ReadResultAsync(DocumentId, id, Actor) is { } original)
                return Result(original, affected);
            return Result(await action(id), affected);
        }
        catch (McpContractException e) { return Error(e.Code, e.Message, id, property: e.Property, expected: e.Expected, actual: e.Actual); }
    }

    private async Task<DocumentState> State(CancellationToken ct)
    {
        var result = await reader.ReadAsync(DocumentId, null, ct);
        return result.State ?? throw new McpContractException(result.Code, "Document unavailable.");
    }

    private INodeProfile Profile(DocumentState state)
    {
        if (PortableUiProfileResolver.Resolve(state.Document.Profile, profile, out var selected) is { } error)
            throw new McpContractException(error.Code, error.Message);
        return selected!;
    }

    [McpServerTool(Name = "create_page"), Description("Create a page with an optional display name.")]
    public Task<CallToolResult> CreatePage(Guid? commandId = null, Guid? pageId = null, string? name = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new AddPageCommand(DocumentId, id, pageId ?? Guid.NewGuid(), name), Actor, ct));

    [McpServerTool(Name = "rename_page"), Description("Rename an existing page.")]
    public Task<CallToolResult> RenamePage(Guid pageId, string name, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new RenamePageCommand(DocumentId, id, pageId, name), Actor, ct));

    [McpServerTool(Name = "create_screen"), Description("Create a screen in a page with dimensions in logical UI units and an optional display name.")]
    public Task<CallToolResult> CreateScreen(Guid pageId, double width, double height, Guid? commandId = null, Guid? screenId = null, string? name = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new AddScreenCommand(DocumentId, id, pageId, screenId ?? Guid.NewGuid(), new(width, height), name), Actor, ct));

    [McpServerTool(Name = "rename_screen"), Description("Rename an existing screen.")]
    public Task<CallToolResult> RenameScreen(Guid screenId, string name, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new RenameScreenCommand(DocumentId, id, screenId, name), Actor, ct));

    [McpServerTool(Name = "resize_screen"), Description("Resize a screen without changing its children.")]
    public Task<CallToolResult> ResizeScreen(Guid screenId, double width, double height, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new ResizeScreenCommand(DocumentId, id, screenId, new(width, height)), Actor, ct));

    [McpServerTool(Name = "duplicate_screen"), Description("Duplicate a screen and all its children at the expected revision, optionally specifying the new screen name.")]
    public Task<CallToolResult> DuplicateScreen(Guid screenId, long expectedRevision, Guid? commandId = null, Guid? newScreenId = null, string? name = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new DuplicateScreenCommand(DocumentId, id, screenId, newScreenId ?? Guid.NewGuid(), expectedRevision, name), Actor, ct));

    [McpServerTool(Name = "create_node"), Description("Create a node with an optional display name and initial properties atomically. Accepts compact or canonical get_node property values, mixed in one request. Use get_node_schema for inputSchema.")]
    public Task<CallToolResult> CreateNode(Guid parentId, string kind, Dictionary<string, JsonElement>? properties = null, Guid? commandId = null, Guid? nodeId = null, string? name = null, CancellationToken ct = default) =>
        Run(commandId, async id =>
        {
            var state = await State(ct);
            var values = McpPropertyAdapter.ConvertProperties(Profile(state), kind, properties ?? new());
            return await handler.HandleAsync(new AddNodeCommand(DocumentId, id, parentId, nodeId ?? Guid.NewGuid(), kind, values, name), Actor, ct);
        });

    [McpServerTool(Name = "rename_node"), Description("Set the display name of an existing node.")]
    public Task<CallToolResult> RenameNode(Guid nodeId, string name, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new SetNodeNameCommand(DocumentId, id, nodeId, name), Actor, ct));

    [McpServerTool(Name = "set_node_properties"), Description("Atomically set only the supplied node properties. Accepts compact or canonical get_node property values, mixed in one request. Use get_node_schema for inputSchema.")]
    public Task<CallToolResult> SetNodeProperties(Guid nodeId, Dictionary<string, JsonElement> properties, Guid? expectedParentId = null, long? expectedRevision = null, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, async id =>
        {
            var state = await State(ct);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId) ??
                throw new McpContractException("NODE_NOT_FOUND", "Node not found.");
            var values = McpPropertyAdapter.ConvertProperties(Profile(state), node.Kind, properties);
            return await handler.HandleAsync(new SetNodePropertiesCommand(DocumentId, id, nodeId, values, expectedParentId, expectedRevision), Actor, ct);
        });

    [McpServerTool(Name = "remove_node_properties"), Description("Remove explicitly stored properties at an expected revision.")]
    public Task<CallToolResult> RemoveNodeProperties(Guid nodeId, string[] properties, long expectedRevision, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new RemoveNodePropertiesCommand(DocumentId, id, nodeId, properties, expectedRevision), Actor, ct));

    [McpServerTool(Name = "move_node"), Description("Move or reorder a node. Position is a zero-based index; expectedParentId guards concurrent moves.")]
    public Task<CallToolResult> MoveNode(Guid nodeId, Guid expectedParentId, Guid targetParentId, int position, long? expectedRevision = null, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new MoveNodeCommand(DocumentId, id, nodeId, expectedParentId, targetParentId, position, expectedRevision), Actor, ct));

    [McpServerTool(Name = "delete_node"), Description("Delete a node and its descendants using the domain deletion rules.")]
    public Task<CallToolResult> DeleteNode(Guid nodeId, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new DeleteNodeCommand(DocumentId, id, nodeId), Actor, ct));

    private static T EnumName<T>(string name) where T : struct, Enum =>
        Enum.GetNames<T>().Contains(name, StringComparer.Ordinal) ? Enum.Parse<T>(name) :
            throw new McpContractException("INVALID_ENUM", "Expected one of: " + string.Join(", ", Enum.GetNames<T>()));

    [McpServerTool(Name = "create_token"), Description("Create a design token with Light and Dark values. Accepts compact values or unchanged Light/Dark expressions from list_tokens (literal or alias), including nested typography fields. Hex colors use #RRGGBB or #RRGGBBAA.")]
    public Task<CallToolResult> CreateToken(string name, string type, JsonElement light, JsonElement dark, string? category = null, Guid? commandId = null, Guid? tokenId = null, CancellationToken ct = default) =>
        Run(commandId, id =>
        {
            var tokenType = EnumName<TokenType>(type);
            var tokenCategory = category is null ? (TokenCategory?)null : EnumName<TokenCategory>(category);
            if (tokenType == TokenType.Spacing && tokenCategory is null)
            {
                tokenType = TokenType.Dimension;
                tokenCategory = TokenCategory.Spacing;
            }
            var values = new Dictionary<TokenTheme, TokenExpression>
            {
                [TokenTheme.Light] = McpPropertyAdapter.Token(tokenType, light, "light"),
                [TokenTheme.Dark] = McpPropertyAdapter.Token(tokenType, dark, "dark")
            };
            return handler.HandleAsync(new AddTokenCommand(DocumentId, id, new(tokenId ?? Guid.NewGuid(), name, tokenType, values, tokenCategory)), Actor, ct);
        }, "tokenId");

    [McpServerTool(Name = "set_token_value"), Description("Set a design token value for Light or Dark; accepts compact values or unchanged expressions from list_tokens (literal or alias).")]
    public Task<CallToolResult> SetTokenValue(Guid tokenId, string theme, JsonElement value, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, async id =>
        {
            var state = await State(ct);
            var token = state.Document.Tokens.FirstOrDefault(t => t.Id == tokenId) ??
                throw new McpContractException("TOKEN_NOT_FOUND", "Token not found.");
            return await handler.HandleAsync(new SetTokenValueCommand(DocumentId, id, tokenId, EnumName<TokenTheme>(theme),
                McpPropertyAdapter.Token(token.Type, value)), Actor, ct);
        }, "tokenId");

    public sealed record ScenarioAction(string Type, Guid ScreenId);

    private static PreviewScenario Scenario(Guid id, Guid screenId, Guid nodeId, string @event, ScenarioAction[] actions)
    {
        var mapped = actions.Select<ScenarioAction, PreviewAction>(a => a.Type == "navigate" ? new Navigate(a.ScreenId) :
            throw new McpContractException("INVALID_SCENARIO", "Supported action: navigate.")).ToArray();
        return new(id, screenId, nodeId, EnumName<PreviewEvent>(@event), mapped);
    }

    [McpServerTool(Name = "create_scenario"), Description("Create an interactive scenario. Use Click or Submit and actions with type navigate and screenId.")]
    public Task<CallToolResult> CreateScenario(Guid screenId, Guid nodeId, string @event, ScenarioAction[] actions, long? expectedRevision = null, Guid? commandId = null, Guid? scenarioId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new CreateScenarioCommand(DocumentId, id, Scenario(scenarioId ?? Guid.NewGuid(), screenId, nodeId, @event, actions), expectedRevision), Actor, ct), "scenarioId");

    [McpServerTool(Name = "update_scenario"), Description("Replace a scenario at the expected revision.")]
    public Task<CallToolResult> UpdateScenario(Guid scenarioId, Guid screenId, Guid nodeId, string @event, ScenarioAction[] actions, long expectedRevision, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new UpdateScenarioCommand(DocumentId, id, Scenario(scenarioId, screenId, nodeId, @event, actions), expectedRevision), Actor, ct), "scenarioId");

    [McpServerTool(Name = "delete_scenario"), Description("Delete a scenario at the expected revision.")]
    public Task<CallToolResult> DeleteScenario(Guid scenarioId, long expectedRevision, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new DeleteScenarioCommand(DocumentId, id, scenarioId, expectedRevision), Actor, ct), "scenarioId");

    [McpServerTool(Name = "save_version"), Description("Save a named immutable version of the document.")]
    public Task<CallToolResult> SaveVersion(string name, Guid? commandId = null, CancellationToken ct = default) =>
        Run(commandId, id => handler.HandleAsync(new SaveDocumentCommand(DocumentId, id, name), Actor, ct));
}
