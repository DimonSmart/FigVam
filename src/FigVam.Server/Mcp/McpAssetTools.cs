using System.ComponentModel;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace FigVam.Server.Mcp;

[McpServerToolType]
public sealed class McpAssetTools(IHttpContextAccessor accessor, IDocumentAssets assets, IDocumentCommandHandler handler)
{
    public const int MaxEncodedAssetLength = ((DocumentAssetValidator.MaxAssetBytes + 2) / 3) * 4;
    public const int MaxRequestBytes = 8 * 1024 * 1024;

    private McpDocumentGrant Grant => (McpDocumentGrant)accessor.HttpContext!.Items[McpServiceRegistration.GrantKey]!;
    private DocumentActor Actor => new(Grant.UserId) { Source = "MCP" };

    [McpServerTool(Name = "list_assets", ReadOnly = true), Description("List document resource metadata and supported upload MIME types. No binary data is returned. Optional revision or versionId, never both.")]
    public async Task<CallToolResult> ListAssets(long? revision = null, Guid? versionId = null, CancellationToken ct = default)
    {
        var result = await assets.ListAsync(Grant.DocumentId, Actor, revision, versionId, ct);
        return McpReadTools.Result(result.Code, result.Response is { } response ? new
        {
            response.DocumentId, response.Revision, response.Assets,
            supportedContentTypes = DocumentAssetContentFormat.SupportedContentTypes,
            maxAssetBytes = DocumentAssetValidator.MaxAssetBytes
        } : null);
    }

    [McpServerTool(Name = "get_asset_info", ReadOnly = true), Description("Read one resource's metadata at a document revision or saved version. No binary data is returned.")]
    public async Task<CallToolResult> GetAssetInfo(Guid assetId, long? revision = null, Guid? versionId = null, CancellationToken ct = default)
    {
        if (assetId == Guid.Empty) return McpReadTools.Result("INVALID_ID", null);
        var result = await assets.ListAsync(Grant.DocumentId, Actor, revision, versionId, ct);
        if (result.Response is not { } response) return McpReadTools.Result(result.Code, null);
        var asset = response.Assets.FirstOrDefault(a => a.Id == assetId);
        return asset is null ? McpReadTools.Result("ASSET_NOT_FOUND", null) :
            McpReadTools.Result("OK", new { response.DocumentId, response.Revision, asset });
    }

    [McpServerTool(Name = "upload_asset"), Description("Upload a binary resource to the granted document using standard padded Base64 (no data URI, URL or file path). Use list_assets to discover supported MIME types. Maximum decoded size 5 MiB. Supply a unique commandId for safe retries. For Image nodes use the returned assetId in properties.asset.")]
    public async Task<CallToolResult> UploadAsset(string contentType, string contentBase64,
        Guid? assetId = null, Guid? commandId = null, CancellationToken ct = default)
    {
        var id = commandId ?? Guid.NewGuid();
        var requestedAsset = assetId ?? Guid.NewGuid();
        CallToolResult Error(string code, string message)
        {
            var data = JsonSerializer.SerializeToElement(new { status = "REJECTED", code, message, commandId = id });
            return new CallToolResult { IsError = true, StructuredContent = data,
                Content = [new TextContentBlock { Text = data.GetRawText() }] };
        }
        if (id == Guid.Empty || requestedAsset == Guid.Empty)
            return Error("INVALID_ID", "commandId and assetId must be nonempty UUIDs.");
        if (!DocumentAssetContentFormat.IsSupported(contentType))
            return Error("INVALID_ASSET", "Unsupported resource MIME type. Use list_assets to discover supported formats.");
        var decoded = DecodeContent(contentBase64);
        if (decoded.Content is not { } bytes)
            return Error(decoded.Code, decoded.Code == "ASSET_TOO_LARGE" ?
                "Decoded resource exceeds 5 MiB." : "Expected standard padded Base64 without whitespace or a data URI.");

        var result = await handler.HandleAsync(new UploadDocumentAssetCommand(
            Grant.DocumentId, id, requestedAsset, contentType, bytes), Actor, ct);
        if (!result.Accepted)
            return Error(result.Code, result.Explanation ?? "Resource upload rejected.");
        // Use the original affected ID on command-stream retry, not a newly generated ID.
        if (result.AffectedIds is not { Count: 1 } affected || result.Revision is not { } revision)
            return Error("COMMAND_ID_IN_USE", "Use a unique commandId for each resource upload.");
        var manifest = await assets.ListAsync(Grant.DocumentId, Actor, revision, cancellationToken: ct);
        if (manifest.Response is not { } response)
            return Error(manifest.Code, "The command result exists, but its resource manifest could not be read.");
        var asset = response.Assets.FirstOrDefault(a => a.Id == affected[0]);
        if (asset is null)
            return Error("COMMAND_ID_IN_USE", "Use a unique commandId for each resource upload.");
        return McpReadTools.Result(result.Code, new
        {
            status = result.Code, result.DocumentId, result.CommandId, result.Revision, assetId = asset.Id, asset
        });
    }

    // Bound allocation before decoding, reject non-Base64 inputs; never resolve client paths.
    internal static (string Code, byte[]? Content) DecodeContent(string? value)
    {
        if (string.IsNullOrEmpty(value)) return ("INVALID_ASSET", null);
        if (value.Length > MaxEncodedAssetLength) return ("ASSET_TOO_LARGE", null);
        if (value.Length % 4 != 0) return ("INVALID_ASSET", null);
        var padding = value.EndsWith("==", StringComparison.Ordinal) ? 2 : value.EndsWith('=') ? 1 : 0;
        var length = value.Length / 4 * 3 - padding;
        if (length > DocumentAssetValidator.MaxAssetBytes) return ("ASSET_TOO_LARGE", null);
        if (length <= 0) return ("INVALID_ASSET", null);
        foreach (var ch in value.AsSpan(0, value.Length - padding))
            if (!(ch is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '+' or '/'))
                return ("INVALID_ASSET", null);
        var bytes = new byte[length];
        return Convert.TryFromBase64String(value, bytes, out var written) && written == length
            ? ("OK", bytes) : ("INVALID_ASSET", null);
    }
}
