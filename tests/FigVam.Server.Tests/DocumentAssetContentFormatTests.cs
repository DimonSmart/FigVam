using FigVam.Application.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentAssetContentFormatTests
{
    [Fact]
    public void PngUsesExistingInspectorAndPortablePath()
    {
        var id = Guid.NewGuid();
        var bytes = DocumentAssetTests.Png();
        var asset = DocumentAssetContentFormat.Inspect(id, "image/png", bytes);
        Assert.NotNull(asset);
        Assert.Equal(SafeRasterImage.Inspect(id, "image/png", bytes), asset);
        Assert.Equal($"assets/{id:N}.png", DocumentContainerFormat.AssetPath(asset!));
        Assert.True(DocumentContainerFormat.IsAssetPath(DocumentContainerFormat.AssetPath(asset!)));
        Assert.Null(DocumentAssetContentFormat.Inspect(id, "image/png", [1, 2, 3]));
    }

    [Theory]
    [InlineData("application/octet-stream", ".bin")]
    public void UnregisteredContentFailsClosed(string type, string extension)
    {
        var id = Guid.NewGuid();
        Assert.False(DocumentAssetContentFormat.IsSupported(type));
        Assert.Null(DocumentAssetContentFormat.Inspect(id, type, DocumentAssetTests.Png()));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:N}{extension}"));
        Assert.Throws<ArgumentException>(() => DocumentContainerFormat.AssetPath(id, type));
    }

    [Fact]
    public void SvgRetainsVectorContentAndCanonicalPath()
    {
        var id = Guid.NewGuid();
        var bytes = System.Text.Encoding.UTF8.GetBytes("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32"><path d="M0 0L24 32" stroke="black"/></svg>""");
        var asset = DocumentAssetContentFormat.Inspect(id, "image/svg+xml", bytes);
        Assert.NotNull(asset);
        Assert.Equal($"assets/{id:N}.svg", DocumentContainerFormat.AssetPath(asset!));
        Assert.True(DocumentContainerFormat.IsAssetPath(DocumentContainerFormat.AssetPath(asset!)));
    }

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<image href='https://example.org/a.png'/>")]
    [InlineData("<rect fill='url(https://example.org/a.svg#p)'/>")]
    [InlineData("<rect onclick='alert(1)'/>")]
    [InlineData("<style>@import 'https://example.org/a.css';</style>")]
    public void SvgRejectsActiveAndExternalContent(string body)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes($"<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>{body}</svg>");
        Assert.Null(DocumentAssetContentFormat.Inspect(Guid.NewGuid(), "image/svg+xml", bytes));
    }

    [Fact]
    public void PathsMustRemainCanonical()
    {
        var id = Guid.NewGuid();
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:N}.PNG"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:N}.png/extra"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{Guid.Empty:N}.png"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:D}.png"));
    }
}
