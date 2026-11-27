using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public sealed class DocumentFontValidatorTests
{
    [Theory]
    [InlineData("font/woff2")]
    [InlineData("font/woff")]
    [InlineData("font/ttf")]
    [InlineData("font/otf")]
    public void RecognizesSupportedFontTypes(string type) => Assert.True(DocumentFontValidator.IsFontContentType(type));

    [Fact]
    public void WeightRangesOverlapOnlyWithinSameStyle()
    {
        var variable = new DocumentFontFace(Guid.NewGuid(), Guid.NewGuid(), "Variable", 100, 900, DocumentFontStyle.Normal);
        var bold = new DocumentFontFace(Guid.NewGuid(), Guid.NewGuid(), "Bold", 700, 700, DocumentFontStyle.Normal);
        Assert.True(DocumentFontValidator.ValidFace(variable));
        Assert.True(DocumentFontValidator.ValidFace(bold));
        Assert.True(DocumentFontValidator.Overlaps(variable, bold));
        Assert.False(DocumentFontValidator.Overlaps(variable, bold with { Style = DocumentFontStyle.Italic }));
        Assert.False(DocumentFontValidator.Overlaps(variable, bold with { WeightFrom = 901, WeightTo = 1000 }));
        Assert.False(DocumentFontValidator.ValidFace(variable with { WeightFrom = 0 }));
        Assert.False(DocumentFontValidator.ValidFace(variable with { WeightTo = 99 }));
        Assert.False(DocumentFontValidator.ValidFace(variable with { WeightTo = 1001 }));
        Assert.False(DocumentFontValidator.ValidFace(variable with { Style = (DocumentFontStyle)99 }));
        Assert.False(DocumentFontValidator.ValidFace(variable with { Name = "bad\nname" }));
    }

    [Fact]
    public void MissingAssetsAndDuplicateIdentifiersAreRejected()
    {
        var face = new DocumentFontFace(Guid.NewGuid(), Guid.NewGuid(), "Regular", 400, 400, DocumentFontStyle.Normal);
        var family = new DocumentFontFamily(Guid.NewGuid(), "Test family", [face]);
        Assert.True(DocumentFontValidator.IsValid([], []));
        Assert.False(DocumentFontValidator.IsValid([family], []));
        Assert.False(DocumentFontValidator.IsValid([family with { Faces = [] }], []));
        Assert.False(DocumentFontValidator.IsValid([family with { Id = face.Id }], []));
        var png = new DocumentAsset(face.AssetId, "image/png", new string('a', 64), 100, 1, 1);
        Assert.False(DocumentFontValidator.IsValid([family], [png]));
        Assert.True(DocumentFontValidator.IsValid([], [png]));
    }
}
