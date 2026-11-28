using System.ComponentModel;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

[McpServerToolType]
public sealed class McpBatchTools(IHttpContextAccessor accessor, DocumentBatchExecutor executor, INodeProfile profile)
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        "create_page", "rename_page", "create_screen", "rename_screen", "resize_screen", "duplicate_screen",
        "create_node", "rename_node", "move_node", "delete_node", "set_node_properties", "remove_node_properties",
        "create_screen_variant", "set_screen_variant_properties", "remove_screen_variant_override",
        "create_token", "set_token_value", "rename_token", "delete_token", "create_scenario", "update_scenario", "delete_scenario"
    };
    private static readonly IReadOnlyDictionary<string, MethodInfo> Methods = typeof(McpWriteTools).GetMethods()
        .Select(method => (method, name: method.GetCustomAttribute<McpServerToolAttribute>()?.Name))
        .Where(item => item.name is not null && Allowed.Contains(item.name))
        .ToDictionary(item => item.name!, item => item.method, StringComparer.Ordinal);
    private static readonly HashSet<string> ReferenceFields = new(StringComparer.Ordinal)
    { "pageId", "screenId", "nodeId", "tokenId", "scenarioId" };

    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    public sealed record Operation(string Id, string Command, JsonElement Arguments);

    [McpServerTool(Name = "execute_batch"), Description("Execute 1–128 document mutations atomically at expectedRevision, maximum 1 MiB. Commands: create_page, rename_page, create_screen, rename_screen, resize_screen, duplicate_screen, create_node, rename_node, move_node, delete_node, set_node_properties, remove_node_properties, create_screen_variant, set_screen_variant_properties, remove_screen_variant_override, create_token, set_token_value, rename_token, delete_token, create_scenario, update_scenario, delete_scenario. Arguments match the standalone tool schemas except commandId and expectedRevision are supplied by the batch. Use a unique operation id and an object {\"$ref\":\"previousId.nodeId\"} anywhere an earlier result ID (pageId, screenId, nodeId, tokenId, scenarioId) is needed. One durable revision; failures roll back all mutations. Repeat commandId to retrieve the original outcome.")]
    public async Task<CallToolResult> ExecuteBatch(long expectedRevision, Operation[] operations, Guid? commandId = null, CancellationToken ct = default)
    {
        var id = commandId ?? Guid.NewGuid();
        if (operations is null || operations.Length is < 1 or > 128 ||
            Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(operations, Options)) > 1024 * 1024)
            return Respond(JsonSerializer.SerializeToElement(new { status = "REJECTED", commandId = id, code = "INVALID_BATCH", message = "Expected 1–128 operations and at most 1 MiB.", rolledBack = true }), true);
        var grant = (McpDocumentGrant)accessor.HttpContext!.Items[McpServiceRegistration.GrantKey]!;
        var actor = new DocumentActor(grant.UserId) { Source = "MCP" };
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked);
        var result = await executor.ExecuteAsync(grant.DocumentId, id, expectedRevision, actor,
            scope => Apply(scope, id, expectedRevision, operations, linked.Token), linked.Token);
        if (result.BatchResponse is not null)
            return Respond(JsonSerializer.Deserialize<JsonElement>(result.BatchResponse), !result.Accepted);
        return Respond(JsonSerializer.SerializeToElement(new { status = "REJECTED", commandId = id, revision = result.Revision,
            code = result.Accepted ? "COMMAND_ID_IN_USE" : result.Code, rolledBack = true }), true);
    }

    private async Task<BatchExecution> Apply(DocumentBatchScope scope, Guid id, long revision, Operation[] operations, CancellationToken ct)
    {
        var tools = new McpWriteTools(accessor, scope.Handler, scope, profile, scope, scope.TokenQueries);
        var prior = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var results = new JsonArray();
        for (var index = 0; index < operations.Length; index++)
        {
            ct.ThrowIfCancellationRequested();
            var operation = operations[index];
            BatchExecution Fail(string code, string message, string? property = null) =>
                new(code, JsonSerializer.Serialize(new { status = "REJECTED", commandId = id, revision,
                    failedOperation = operation?.Id, operationIndex = index, code, message, property, rolledBack = true }, Options));
            if (operation is null || string.IsNullOrWhiteSpace(operation.Id) || operation.Id.Length > 128 ||
                operation.Id.Contains('.') || prior.ContainsKey(operation.Id))
                return Fail("INVALID_BATCH", "Operation IDs must be unique, nonempty, at most 128 characters, and cannot contain a dot.");
            if (operation.Command is null || !Methods.TryGetValue(operation.Command, out var method))
                return Fail("INVALID_BATCH", "Command is not supported by execute_batch.");
            try
            {
                var resolved = Resolve(operation.Arguments, prior) as JsonObject
                    ?? throw new JsonException("Expected an arguments object.");
                if (resolved.ContainsKey("commandId") || resolved.ContainsKey("expectedRevision"))
                    return Fail("INVALID_BATCH", "Nested commandId and expectedRevision are not allowed.");
                var parameters = method.GetParameters();
                var args = new object?[parameters.Length];
                for (var i = 0; i < parameters.Length; i++)
                {
                    var parameter = parameters[i];
                    var name = parameter.Name!;
                    if (parameter.ParameterType == typeof(CancellationToken)) args[i] = ct;
                    else if (name == "commandId") args[i] = null;
                    else if (name == "expectedRevision") args[i] = scope.State.Revision;
                    else if (resolved.TryGetPropertyValue(name, out var value))
                    {
                        if (value is null && (!parameter.HasDefaultValue || parameter.DefaultValue is not null))
                            throw new JsonException("Required argument is null.");
                        args[i] = value?.Deserialize(parameter.ParameterType, Options);
                        resolved.Remove(name);
                    }
                    else if (parameter.HasDefaultValue) args[i] = parameter.DefaultValue;
                    else throw new JsonException("Missing required argument: " + name);
                }
                if (resolved.Count != 0) throw new JsonException("Unknown argument.");
                // Invoke the same typed adapter, never JSON-RPC or the durable journal.
                var call = await (Task<CallToolResult>)method.Invoke(tools, args)!;
                var data = JsonNode.Parse(call.StructuredContent!.Value.GetRawText())!.AsObject();
                if (call.IsError == true)
                    return Fail(data["code"]?.GetValue<string>() ?? "REJECTED",
                        data["message"]?.GetValue<string>() ?? "The command was rejected.", data["property"]?.GetValue<string>());
                var item = new JsonObject { ["id"] = operation.Id, ["status"] = "ACCEPTED" };
                foreach (var field in ReferenceFields)
                    if (data[field] is { } value) item[field] = value.DeepClone();
                prior.Add(operation.Id, item);
                results.Add(item);
            }
            catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException or TargetInvocationException)
            {
                return Fail("INVALID_BATCH_ARGUMENTS", "Invalid arguments or reference for " + operation.Command + ".");
            }
        }
        var response = new JsonObject { ["status"] = "ACCEPTED", ["commandId"] = id,
            ["revision"] = checked(revision + 1), ["results"] = results };
        return new("ACCEPTED", response.ToJsonString());
    }

    private static JsonNode? Resolve(JsonElement value, IReadOnlyDictionary<string, JsonObject> prior)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            if (value.TryGetProperty("$ref", out var reference))
            {
                if (value.EnumerateObject().Count() != 1 || reference.ValueKind != JsonValueKind.String)
                    throw new JsonException("Invalid reference.");
                var parts = reference.GetString()!.Split('.');
                if (parts.Length != 2 || !ReferenceFields.Contains(parts[1]) || !prior.TryGetValue(parts[0], out var source) ||
                    source[parts[1]] is not { } target)
                    throw new JsonException("Reference must point to a previous operation result.");
                return target.DeepClone();
            }
            var obj = new JsonObject();
            foreach (var member in value.EnumerateObject()) obj.Add(member.Name, Resolve(member.Value, prior));
            return obj;
        }
        if (value.ValueKind == JsonValueKind.Array) return new JsonArray(value.EnumerateArray().Select(v => Resolve(v, prior)).ToArray());
        if (value.ValueKind == JsonValueKind.Undefined) throw new JsonException("Missing arguments.");
        return JsonNode.Parse(value.GetRawText());
    }

    private static CallToolResult Respond(JsonElement value, bool error) =>
        new() { IsError = error, StructuredContent = value, Content = [new TextContentBlock { Text = value.GetRawText() }] };
}
