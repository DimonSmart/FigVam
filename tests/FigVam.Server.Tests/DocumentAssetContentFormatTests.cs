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
    [InlineData("image/svg+xml", ".svg")]
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
    public void PathsMustRemainCanonical()
    {
        var id = Guid.NewGuid();
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:N}.PNG"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:N}.png/extra"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{Guid.Empty:N}.png"));
        Assert.False(DocumentContainerFormat.IsAssetPath($"assets/{id:D}.png"));
    }
}
