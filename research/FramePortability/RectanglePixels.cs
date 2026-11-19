// Research-only measurement shared by the four independently locked probes.
internal static class RectanglePixels
{
    private static int nestedFailures;

    internal static void ThrowIfNestedFailures()
    {
        if (nestedFailures != 0) throw new Exception($"{nestedFailures} nested captures failed strict clipping; see NESTED measurements.");
    }

    internal static void Check(string target, int width, int height, double logicalWidth, double logicalHeight,
        double scale, int expectedAlpha, Func<int, int, (int R, int G, int B, int A)> pixel)
    {
        var interior = 0;
        var minAlpha = 255;
        var maxAlpha = 0;
        var colors = new HashSet<string>();
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            var p = pixel(x, y);
            minAlpha = Math.Min(minAlpha, p.A);
            maxAlpha = Math.Max(maxAlpha, p.A);
            colors.Add($"{p.R},{p.G},{p.B},{p.A}");
            if (x + 1 <= logicalWidth * scale && y + 1 <= logicalHeight * scale)
            {
                interior++;
                if (Math.Abs(p.A - expectedAlpha) > 1 || Math.Abs(p.R - 64) > 2 ||
                    Math.Abs(p.G - 128) > 2 || Math.Abs(p.B - 192) > 2)
                    throw new Exception($"{target}: interior pixel {x},{y} = {p}; expected RGBA 64,128,192,{expectedAlpha}.");
            }
            if (p.A > expectedAlpha + 1) throw new Exception(target + ": excessive alpha.");
        }
        if (interior == 0 || Math.Abs(maxAlpha - expectedAlpha) > 1)
            throw new Exception(target + ": no verified solid interior.");
        Console.WriteLine($"RECTANGLE {target}; bounds={logicalWidth}x{logicalHeight}; scale={scale}; fill=64,128,192,{expectedAlpha}; bitmap={width}x{height}; interior={interior}; alpha={minAlpha}..{maxAlpha}; colors=[{string.Join(';', colors.Order())}]");
    }

    internal static void CheckNested(string target, int width, int height, double fw, double fh,
        double scale, string mode, int alpha, Func<int,int,(int R,int G,int B,int A)> pixel)
    {
        var clipped = mode == "clip";
        var overflowing = mode != "offset";
        var x0 = 8 + (overflowing ? -2.25 : .25);
        var y0 = 8 + (overflowing ? -3.375 : .375);
        var x1 = x0 + fw + (overflowing ? 4.5 : 0);
        var y1 = y0 + fh + (overflowing ? 6.75 : 0);
        var left = clipped ? 8 : x0;
        var top = clipped ? 8 : y0;
        var right = clipped ? 8 + fw : x1;
        var bottom = clipped ? 8 + fh : y1;
        int interior = 0, outside = 0, overhang = 0, min = 255, max = 0, boundaryInteriorDifferences = 0, boundaryOutsideDifferences = 0;
        // Chromium snaps fractional CSS fill edges; retain geometric fringe differences separately.
        var inset = clipped ? 0 : scale;
        var colors = new HashSet<string>();
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            var p = pixel(x,y);
            min = Math.Min(min,p.A); max = Math.Max(max,p.A);
            colors.Add($"{p.R},{p.G},{p.B},{p.A}");
            var matches = Math.Abs(p.A-alpha)<=1 && Math.Abs(p.R-64)<=2 && Math.Abs(p.G-128)<=2 && Math.Abs(p.B-192)<=2;
            if (x >= left*scale && y >= top*scale && x+1 <= right*scale && y+1 <= bottom*scale && !matches)
                boundaryInteriorDifferences++;
            if (x >= left*scale+inset && y >= top*scale+inset && x+1 <= right*scale-inset && y+1 <= bottom*scale-inset)
            {
                interior++;
                if (!matches && !clipped) throw new Exception($"{target}: nested interior {x},{y}={p}, expected alpha {alpha}.");
            }
            if (x+1 <= left*scale || y+1 <= top*scale || x >= right*scale || y >= bottom*scale)
            {
                outside++;
                if (p.A != 0)
                {
                    boundaryOutsideDifferences++;
                    if (!clipped && (x+1 <= left*scale-inset || y+1 <= top*scale-inset || x >= right*scale+inset || y >= bottom*scale+inset))
                        throw new Exception($"{target}: nested outside {x},{y} alpha={p.A}.");
                }
            }
            if (p.A>0 && (x+1<=8*scale || y+1<=8*scale || x>=(8+fw)*scale || y>=(8+fh)*scale)) overhang++;
            if (p.A>alpha+1) throw new Exception(target+": nested excessive alpha.");
        }
        if (mode == "visible" && overhang == 0) throw new Exception(target+": overflow positive control did not paint outside Frame.");
        if (outside == 0 || (clipped && interior == 0)) throw new Exception(target+": insufficient nested capture coverage.");
        var failed = clipped && (boundaryInteriorDifferences != 0 || boundaryOutsideDifferences != 0);
        if (failed) nestedFailures++;
        Console.WriteLine(FormattableString.Invariant($"NESTED {target}; mode={mode}; status={(failed ? "FAIL" : "PASS")}; frame=8,8,{fw},{fh}; child={x0-8},{y0-8},{x1-x0},{y1-y0}; scale={scale}; fill=64,128,192,{alpha}; bitmap={width}x{height}; interior={interior}; outside={outside}; paintedOutsideFrame={overhang}; geometricInteriorDifferences={boundaryInteriorDifferences}; geometricOutsideDifferences={boundaryOutsideDifferences}; alpha={min}..{max}; colors=[{string.Join(';',colors.Order())}]"));
    }

    internal static (int R, int G, int B, int A) FromPremultiplied(byte[] bytes, int offset)
    {
        var a = bytes[offset + 3];
        int Straight(int channel) => a == 0 ? 0 : (int)Math.Round(channel * 255.0 / a);
        return (Straight(bytes[offset + 2]), Straight(bytes[offset + 1]), Straight(bytes[offset]), a);
    }
}
