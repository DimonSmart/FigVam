using System.Text.Json;
using FigVam.Domain.Documents;

namespace FigVam.Server.Tests;

public sealed class DataBindingTests
{
    private static DataBinding Path(params DataPathSegment[] path) => new(path);
    private static DataResult Eval(string json, DataBinding binding) => DataBindingEvaluator.EvaluateFixture(json, binding);

    [Theory]
    [InlineData("[]", 0)]
    [InlineData("[{\"name\":\"one\"}]", 1)]
    [InlineData("[{\"name\":\"one\"},{\"name\":\"two\"}]", 2)]
    public void ListsSupportCountsEmptyViewsAndRepeaterItems(string json, int count)
    {
        var root = Path();
        Assert.Equal(count, Eval(json, root with { Operation = DataOperation.Count }).Value!.Value.GetInt32());
        Assert.Equal(count == 0, Eval(json, root with { Operation = DataOperation.IsEmpty }).Value!.Value.GetBoolean());
        using var fixture = JsonDocument.Parse(json);
        var result = DataBindingEvaluator.EvaluateRepeater(fixture.RootElement, root,
            [Path(new DataProperty("name")) with { ExpectedType = DataExpectedType.String }]);
        Assert.True(result.Success); Assert.Equal(count, result.Items!.Count);
        Assert.All(result.Items, item => Assert.True(item[0].Success));
    }

    [Fact]
    public void PathsAndTypedValuesAreEvaluatedRelativeToRoot()
    {
        const string json = "{\"rows\":[{\"title\":\"Hi\",\"image\":\"asset.png\",\"visible\":true,\"n\":1}]}";
        DataBinding Field(string name, DataExpectedType type) => Path(new DataProperty("rows"), new DataIndex(0), new DataProperty(name)) with { ExpectedType = type };
        Assert.Equal("Hi", Eval(json, Field("title", DataExpectedType.String)).Value!.Value.GetString());
        Assert.Equal("asset.png", Eval(json, Field("image", DataExpectedType.String)).Value!.Value.GetString());
        Assert.True(Eval(json, Field("visible", DataExpectedType.Boolean)).Value!.Value.GetBoolean());
        Assert.Equal(1, Eval(json, Field("n", DataExpectedType.Number)).Value!.Value.GetInt32());
        Assert.Equal("incompatible-type", Eval(json, Field("n", DataExpectedType.String)).Diagnostic!.Code);
        Assert.Equal("incompatible-type", Eval(json, Path(new DataProperty("rows"), new DataProperty("x"))).Diagnostic!.Code);
        Assert.Equal("missing-value", Eval(json, Path(new DataProperty("rows"), new DataIndex(2))).Diagnostic!.Code);
        Assert.Equal("incompatible-type", Eval(json, Field("n", DataExpectedType.Any) with { Operation = DataOperation.IsEmpty }).Diagnostic!.Code);
    }

    [Fact]
    public void MissingAndNullRemainDistinct()
    {
        const string json = "{\"a\":null}";
        var present = Path(new DataProperty("a")); var missing = Path(new DataProperty("b"));
        Assert.True(Eval(json, present with { Operation = DataOperation.IsPresent }).Value!.Value.GetBoolean());
        Assert.True(Eval(json, present with { Operation = DataOperation.IsNull }).Value!.Value.GetBoolean());
        Assert.False(Eval(json, missing with { Operation = DataOperation.IsPresent }).Value!.Value.GetBoolean());
        Assert.Equal("missing-value", Eval(json, missing with { Operation = DataOperation.IsNull }).Diagnostic!.Code);
        Assert.Equal(JsonValueKind.Null, Eval(json, present).Value!.Value.ValueKind);
        Assert.Equal("incompatible-type", Eval(json, present with { ExpectedType = DataExpectedType.String }).Diagnostic!.Code);
    }

    [Fact]
    public void InvalidPathsAndLimitsReturnDiagnostics()
    {
        Assert.Equal("invalid-fixture", Eval("{", Path()).Diagnostic!.Code);
        Assert.Equal("invalid-path", Eval("{}", Path(new DataProperty(""))).Diagnostic!.Code);
        Assert.Equal("invalid-path", Eval("[]", Path(new DataIndex(-1))).Diagnostic!.Code);
        Assert.Equal("invalid-path", Eval("{}", Path(Enumerable.Repeat<DataPathSegment>(new DataProperty("a"), 33).ToArray())).Diagnostic!.Code);
        using var many = JsonDocument.Parse("[" + string.Join(',', Enumerable.Repeat("0", DataBindingEvaluator.MaxRepeaterItems + 1)) + "]");
        Assert.Equal("repeater-limit", DataBindingEvaluator.EvaluateRepeater(many.RootElement, Path(), []).Diagnostic!.Code);
        using var rows = JsonDocument.Parse("[" + string.Join(',', Enumerable.Repeat("{}", 101)) + "]");
        var bindings = Enumerable.Repeat(Path(new DataProperty("x")), 100).ToArray();
        Assert.Equal("repeater-limit", DataBindingEvaluator.EvaluateRepeater(rows.RootElement, Path(), bindings).Diagnostic!.Code);
    }
}
