using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Domain.Layout;
using FigVam.Domain.Preview;
using FigVam.Domain.Tokens;

namespace FigVam.Server.Mcp;

// All browser inputs are read through revision-pinned, authorized document queries.
public sealed class HeadlessPreviewCapture(IConfiguration configuration,
    IDocumentStructureQueries queries, IDocumentTokenQueries tokens, IDocumentAssets assets,
    IDocumentPreviewFactory previews, PlaywrightPreviewBrowser browser) : IScreenCaptureService
{
    private readonly SemaphoreSlim slots = new(Math.Clamp(configuration.GetValue("Mcp:RenderConcurrency", 2), 1, 16));
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, Guid screenId, long revision,
        CancellationToken ct, string? theme = null, int width = 0, int height = 0)
    {
        var actor = new DocumentActor(grant.UserId);
        var info = await queries.QueryAsync(grant.DocumentId, new("screen", screenId, Fields: "dimensions", Revision: revision), actor, ct);
        if (info.Response is null) return new(info.Code);
        var dimensions = info.Response.Items.Single().Dimensions!;
        var preview = await previews.CreateAsync(grant.DocumentId, revision,
            new(screenId, null, null, theme == "Dark" ? TokenTheme.Dark : TokenTheme.Light,
                new(dimensions.Width, dimensions.Height)), actor, ct);
        if (preview.Preview is not { } state) return new(preview.Code);
        return await CaptureAsync(grant, revision, state.Session, state.Session.Values, ct);
    }

    public async Task<ScreenCaptureResult> CaptureAsync(McpDocumentGrant grant, long revision, PreviewSession session,
        IReadOnlyDictionary<Guid, string?> values, CancellationToken ct)
    {
        var screen = session.Selection.ScreenId;
        var actor = new DocumentActor(grant.UserId);
        var info = await queries.QueryAsync(grant.DocumentId, new("screen", screen, Fields: "dimensions", Revision: revision), actor, ct);
        if (info.Response is null) return new(info.Code);
        var dimensions = info.Response.Items.Single().Dimensions!;
        if (dimensions.Width < 1 || dimensions.Height < 1 || dimensions.Width > 4096 || dimensions.Height > 4096 ||
            Math.Ceiling(dimensions.Width) * Math.Ceiling(dimensions.Height) > 4 * 1024 * 1024)
            return new("IMAGE_TOO_LARGE");
        var width = (int)Math.Ceiling(dimensions.Width);
        var height = (int)Math.Ceiling(dimensions.Height);
        var theme = session.Selection.Theme;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct, grant.CaptureRevoked);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        var token = timeout.Token;
        var acquired = false;
        try
        {
            await slots.WaitAsync(token);
            acquired = true;
            var profile = await queries.ReadProfileAsync(grant.DocumentId, revision, actor, token);
            var manifest = await assets.ListAsync(grant.DocumentId, actor, revision, cancellationToken: token);
            if (profile.Response is null || manifest.Response is null) return new("CAPTURE_FAILED");

            var tokenItems = new List<DesignToken>();
            int total;
            do
            {
                var page = await tokens.ListAsync(grant.DocumentId, revision, tokenItems.Count, 100, actor, token);
                if (page.Response is not { } response) return new(page.Code);
                tokenItems.AddRange(response.Items);
                total = response.Total;
                if (!response.Items.Any() && tokenItems.Count < total) return new("CAPTURE_FAILED");
            } while (tokenItems.Count < total);

            var surfaces = new List<object>();
            var referenced = new HashSet<Guid>();
            foreach (var (id, index) in session.Overlays.Prepend(screen).Select((id, index) => (id, index)))
            {
                var nodes = new List<StructureItem>();
                var boxes = new List<LayoutBox>();
                var overrides = new List<ScreenLayoutOverride>();
                do
                {
                    var page = await queries.QueryAsync(grant.DocumentId, new("nodes", Offset: nodes.Count, Limit: 100,
                        Fields: "kind,properties,name,parentId,childCount,canContainChildren", ScreenId: id, Revision: revision), actor, token);
                    if (page.Response is not { } response) return new(page.Code);
                    nodes.AddRange(response.Items);
                    total = response.Total;
                    if (!response.Items.Any() && nodes.Count < total) return new("CAPTURE_FAILED");
                } while (nodes.Count < total);
                do
                {
                    var page = await queries.ReadScreenLayoutAsync(grant.DocumentId, new(id, revision, boxes.Count, 100,
                        dimensions, index == 0 ? session.Selection.VariantId : null, session.Selection.DatasetId, theme), actor, token);
                    if (page.Response is not { } response) return new(page.Code);
                    boxes.AddRange(response.Boxes);
                    overrides.AddRange(response.Overrides ?? []);
                    total = response.Total;
                    if (!response.Boxes.Any() && boxes.Count < total) return new("CAPTURE_FAILED");
                } while (boxes.Count < total);
                referenced.UnionWith(nodes.SelectMany(n => n.Properties?.Values ?? Enumerable.Empty<NodePropertyValue>())
                    .Concat(overrides.SelectMany(o => o.Properties.Values)).OfType<NodeAssetValue>().Select(v => v.AssetId));
                surfaces.Add(new { screen = id, theme = theme.ToString(), nodes, boxes, overrides });
            }
            var assetData = new Dictionary<Guid, string>();
            foreach (var id in referenced)
            {
                var asset = await assets.ReadAsync(grant.DocumentId, id, actor, revision, cancellationToken: token);
                if (asset.Content is null) return new(asset.Code);
                assetData[id] = Convert.ToBase64String(asset.Content.Content);
            }

            var snapshot = JsonSerializer.Serialize(new { revision, width, height, theme = theme.ToString(), surfaces,
                kinds = profile.Response.Kinds, tokens = tokenItems, assets = manifest.Response.Assets, assetData, values }, Json);
            var png = await browser.ScreenshotAsync(snapshot, width, height, token);
            token.ThrowIfCancellationRequested();
            var result = ScreenCaptureResult.FromPng(png) with { Theme = theme.ToString() };
            if (result.Png is null) return result;
            return result.Width == width && result.Height == height ? result : new("CAPTURE_FAILED");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new(grant.CaptureRevoked.IsCancellationRequested ? "ACCESS_DENIED" : "CAPTURE_TIMEOUT");
        }
        catch (PreviewBrowserUnavailableException) { return new("RENDER_UNAVAILABLE"); }
        catch (Microsoft.Playwright.TimeoutException) { return new("CAPTURE_TIMEOUT"); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or Microsoft.Playwright.PlaywrightException or InvalidOperationException or FormatException)
        {
            return new("CAPTURE_FAILED");
        }
        finally { if (acquired) slots.Release(); }
    }
}
