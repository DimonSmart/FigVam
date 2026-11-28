using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/assets")]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403)]
[ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(409), ProducesResponseType<ApiError>(413)]
[ProducesResponseType<ApiError>(415), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentAssetController(IDocumentCommandHandler handler, IDocumentAssets assets, IDocumentAuthorization authorization) : ControllerBase
{
    // Permit one sentinel byte so a boundary-size upload receives HTTP 413 after body completion.
    // The application still rejects every asset above MaxAssetBytes.
    [HttpPut("{assetId}"), RequestSizeLimit(DocumentAssetValidator.MaxAssetBytes + 1)]
    [ProducesResponseType<CommandResponse>(200)]
    [EndpointSummary("Upload a safe raster asset through the document command stream")]
    [EndpointDescription("Raw image/png body, at most 5 MiB; commandId and assetId must be nonempty UUIDs. Static noninterlaced 8-bit grayscale, RGB, gray-alpha or RGBA PNG only. IHDR, consecutive IDAT and IEND chunks only; CRC, zlib/Adler, scanline lengths and filters validated. Metadata, palettes, animation, SVG, external links, trailing bytes and other formats are rejected. Maximum dimension 4096, 4194304 pixels, 256 assets and 64 MiB per document. Editor or Owner required. Content, SHA-256, manifest, revision and event commit atomically. commandId retries return the original result; undo removes an asset only if references remain valid. Retained blobs are never collected in this version.")]
    public async Task<IActionResult> Upload(Guid documentId, Guid assetId, [FromQuery] Guid commandId, CancellationToken ct)
    {
        var actor = User.GetDocumentActor();
        if (!await authorization.CanEditAsync(actor, documentId, ct)) return Error("FORBIDDEN");
        if (!MediaTypeHeaderValue.TryParse(Request.ContentType, out var contentType) ||
            contentType.MediaType.ToString().ToLowerInvariant() != "image/png")
        {
            await Request.Body.CopyToAsync(Stream.Null, ct);
            return StatusCode(415, ApiErrors.Create(415));
        }
        // Kestrel caps the request at MaxAssetBytes + one sentinel byte.
        // Finish reading the bounded request before returning 413: responding while
        // the client is still uploading can turn a valid rejection into a TCP reset.
        using var body = new MemoryStream();
        await Request.Body.CopyToAsync(body, ct);
        if (body.Length > DocumentAssetValidator.MaxAssetBytes) return Error("ASSET_TOO_LARGE");
        var result = await handler.HandleAsync(new UploadDocumentAssetCommand(documentId, commandId, assetId,
            contentType.MediaType.ToString().ToLowerInvariant(), body.ToArray()), actor, ct);
        return result.Accepted ? Ok(new CommandResponse(result.Code, documentId, commandId, result.Revision!.Value,
            null, null, null, null, result.AffectedIds!)) : Error(result.Code);
    }

    [HttpGet, ProducesResponseType<DocumentAssetsResponse>(200)]
    [EndpointSummary("Read a bounded asset manifest at a revision or saved version")]
    [EndpointDescription("Omit selectors for current draft; supply revision or versionId, never both. Returns at most 256 immutable manifest entries, without content. Current document read permission is required, including for saved versions.")]
    public async Task<IActionResult> List(Guid documentId, [FromQuery] long? revision, [FromQuery] Guid? versionId, CancellationToken ct)
    {
        var result = await assets.ListAsync(documentId, User.GetDocumentActor(), revision, versionId, ct);
        return result.Response is { } response ? Ok(response) : Error(result.Code);
    }

    [HttpGet("{assetId}"), Produces("image/png", "font/woff2", "font/woff", "font/ttf", "font/otf", "application/json"), ProducesResponseType<FileContentResult>(200)]
    [EndpointSummary("Read verified image or font bytes from a document snapshot")]
    [EndpointDescription("Requires current document read permission and asset membership in the selected draft revision or saved version. revision and versionId are mutually exclusive. Returns the asset MIME type with no-store, nosniff, sandbox CSP and SHA-256 ETag; no public storage URLs or redirects. At most 5 MiB.")]
    public async Task<IActionResult> Read(Guid documentId, Guid assetId, [FromQuery] long? revision, [FromQuery] Guid? versionId, CancellationToken ct)
    {
        var result = await assets.ReadAsync(documentId, assetId, User.GetDocumentActor(), revision, versionId, ct);
        if (result.Content is not { } content) return Error(result.Code);
        Response.Headers.CacheControl = "no-store";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        Response.Headers.ETag = "\"" + content.Asset.Sha256 + "\"";
        Response.Headers["X-Document-Revision"] = result.Revision!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return File(content.Content, content.Asset.ContentType);
    }

    private ObjectResult Error(string code)
    {
        var status = code switch
        {
            "FORBIDDEN" => 403,
            "DOCUMENT_NOT_FOUND" or "ASSET_NOT_FOUND" or "VERSION_NOT_FOUND" or "REVISION_UNAVAILABLE" => 404,
            "DUPLICATE_ID" or "ASSET_LIMIT_EXCEEDED" => 409,
            "ASSET_TOO_LARGE" => 413,
            "ASSET_CONTENT_UNAVAILABLE" => 500,
            _ => 400
        };
        return StatusCode(status, ApiErrors.Create(status, code));
    }
}
