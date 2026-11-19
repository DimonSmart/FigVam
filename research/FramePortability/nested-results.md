# Fractional Rectangle placement and Frame clipping — 2026-11-18

Research for IDD-0002/0004/0005/0014. No production capability or support is
declared. Intent, Engineering, production code, package locks and cases remain
unchanged. Existing blank Frame/calibration and standalone Rectangle probes are
retained and run before these nested samples. See the prior
[Rectangle report](rectangle-results.md) for its separate evidence.

## Result and reproduction

All four locked targets restored, built and executed. Of **108 nested captures**,
106 passed and **two HTML captures failed strict clipping**. HTML passed 52/54;
WPF, Avalonia and Uno passed 18/18 each. No target was skipped or unavailable.
The unchanged PowerShell runner aggregates and reports the HTML project failure, then terminates nonzero. The underlying `dotnet run` process ended with code **-532462766** after the strict clipping assertion threw; see the full trace in [final output](nested-output.txt).

Actual final command from `C:\Private\FigVam`:

```powershell
pwsh -NoProfile -File research/FramePortability/run.ps1 *> research/FramePortability/nested-output.txt
```

The runner executes the following for each project:

```powershell
dotnet restore research/FramePortability/Html/Html.csproj --locked-mode
dotnet run --project research/FramePortability/Html/Html.csproj --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
dotnet restore research/FramePortability/Wpf/Wpf.csproj --locked-mode
dotnet run --project research/FramePortability/Wpf/Wpf.csproj --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
dotnet restore research/FramePortability/Avalonia/FigVam.FrameResearch.Avalonia.csproj --locked-mode
dotnet run --project research/FramePortability/Avalonia/FigVam.FrameResearch.Avalonia.csproj --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
dotnet restore research/FramePortability/Uno/Uno.csproj --locked-mode
dotnet run --project research/FramePortability/Uno/Uno.csproj --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
```

[Final output](nested-output.txt) contains every retained and nested measurement.
[Initial output](nested-initial-output.txt) preserves the first strict geometric
interior failure in HTML. That run continued to WPF/Avalonia/Uno. The complete
final measurements supersede its fail-fast HTML sample and retain fringe
differences explicitly rather than asserting equivalence there.

Windows NT 10.0.26200.0; .NET SDK 10.0.204; locked Playwright 1.64.1,
SkiaSharp 3.119.2, Avalonia 12.1.6, Uno.Sdk 7.0.22 / Uno.WinUI 7.0.65.
Edge/Chromium 157.0.4341.60, light 640×480 viewport, DPR 1/1.5/2.
WPF offscreen 96 DPI; Avalonia headless real Skia at 96 DPI;
Uno actual Skia/Win32 Window at XamlRoot scale 1.25.

## Inputs and mappings

Frame sizes remain **320×180, 123.5×67.25, 1×1 uiUnit**. A transparent capture
stage positions the Frame at (8,8); stage dimensions are ceil(width)+24 by
ceil(height)+24. Each sample has exactly one Rectangle, RGB (64,128,192),
brush alpha 255 or 128, without stroke, radius or interaction.

| Mode | Child bounds relative to Frame | Overflow |
| --- | --- | --- |
| offset | (0.25,0.375,width,height) | Visible |
| visible | (-2.25,-3.375,width+4.5,height+6.75) | Visible positive control |
| clip | Same overhanging child as visible | Clip to Frame rectangle |

These are derived nested inputs; shared cases and standalone Rectangle sizes
are preserved. Frame origin, child origin and both dimensions matched the above
inputs: exact equality in HTML/WPF/Avalonia, tolerance 0.0001 uiUnit in Uno.

| Target | Added research mapping |
| --- | --- |
| HTML/CSS | Positioned div Frame and absolute div child; CSS left/top/width/height; overflow:hidden only for clip; transparent full-stage screenshot. |
| WPF | Canvas Frame/stage; Canvas.Left/Top; explicit RectangleGeometry Clip on Frame only for clip; Shapes.Rectangle Fill; stage RenderTargetBitmap Pbgra32. |
| Avalonia | Canvas Frame/stage; Canvas.Left/Top; explicit RectangleGeometry Clip; Shapes.Rectangle Fill; stage RenderTargetBitmap PNG decoded by Skia. |
| Uno | Canvas Frame/stage; Canvas.Left/Top; explicit RectangleGeometry Clip; Shapes.Rectangle Fill; stage RenderTargetBitmap BGRA at actual XamlRoot scale. |

The original empty Frame Grid mapping is retained. Canvas is the separate
absolute-position container mapping investigated here. Native stage, Frame and
Rectangle disable layout rounding. Alpha is brush alpha, not group opacity.

## Pixel checks and target failure

Stage margins ensure capture cropping cannot masquerade as parent clipping.
Every visible control must paint pixels wholly outside the Frame. Every clipped
capture checks alpha zero for **every captured pixel whose complete unit square
lies outside the logical Frame**. Boundary-straddling pixels can have fractional
coverage; their unique RGBA values are logged. No tolerance permits paint in a
wholly outside pixel.

All fully covered clipped interior pixels are checked for alpha within one byte
and straight RGB within two bytes. WPF/Uno premultiplied BGRA is explicitly
unpremultiplied. Every clipped interior matched: opaque (64,128,192,255),
half-alpha (64,128,191,128). The one-byte blue difference is consistent with
8-bit premultiplication. This includes the 1×1 Frame at every tested scale.

For the unclipped modes, color assertions use a core inset by **one logical
unit** from each child edge. The log separately counts disagreements in all
geometrically fully covered pixels (`geometricInteriorDifferences`) and paint
in geometrically outside pixels (`geometricOutsideDifferences`). This distinction
was introduced after the initial run exposed fractional CSS fill-edge snapping.
It does not weaken strict clipped Frame checks. Offset 1×1 has no inset core;
that mode establishes bounds and observed raster coverage only for this size.
Larger offset cases and every clipped case have checked interior pixels.

**Failure:** HTML DPR 2, Frame 123.5×67.25, both alpha values. Logical bounds
are (8,8,123.5,67.25), so the right physical edge is x=263. Nevertheless
**134 wholly outside pixels in column x=263 are painted**, with alpha 255 or 128.
All 33,098 fully covered interior pixels match. Thus this overflow:hidden mapping
fails strict logical clipping. No alternative CSS clipping mapping was substituted.

At HTML DPR 1.5, unclipped modes also show fractional fill-edge differences:
summed over both alpha values and all sizes, 2,340 geometrically interior pixels
differ and 384 geometrically outside pixels are painted. These lie in the
reported one-unit boundary fringe; inset cores pass. Native captures have zero
such geometric differences. These counts are observations, not a general tolerance.

## Capture sizes and clipping evidence

Sizes follow the unchanged input order. Interior counts are per clipped capture,
identical for the two alpha values.

| Target/scale | Stage bitmaps | Checked clipped interior pixels | Nested result |
| --- | --- | --- | --- |
| HTML DPR 1 | 344×204 / 148×92 / 25×25 | 57,600 / 8,241 / 1 | 18/18 pass |
| HTML DPR 1.5 | 516×306 / 222×138 / 38×38 | 129,600 / 18,500 / 1 | 18/18 pass; unclipped fringe differs |
| HTML DPR 2 | 688×408 / 296×184 / 50×50 | 230,400 / 33,098 / 4 | 16/18 pass; fractional clip fails twice |
| WPF 96 DPI | 344×204 / 148×92 / 25×25 | 57,600 / 8,241 / 1 | 18/18 pass |
| Avalonia 96 DPI | 344×204 / 148×92 / 25×25 | 57,600 / 8,241 / 1 | 18/18 pass |
| Uno scale 1.25 | 430×255 / 185×115 / 31×31 | 90,000 / 12,936 / 1 | 18/18 pass |

Successful clip captures paint zero wholly outside pixels. Visible controls
paint outside for every size/alpha/target. Fractional edge rasterization differs:
for clipped 1×1 at Uno scale 1.25, opaque edge alphas include 16/64, half-alpha
8/32; HTML DPR 1.5 includes 128/64 respectively. Low-coverage edge RGB rounding
is recorded without being treated as interior color equivalence.

## Accessibility and limits

HTML nested Chromium AX trees expose unignored roles
RootWebArea,generic,generic,generic; assertions reject button/textbox/checkbox/
link/image roles. No role/tabindex is authored; child pointer-events is none.
WPF parent/child peers are absent; child focus/hit testing are disabled.
Avalonia parent/child automation types are None; child focus/hit testing are
disabled. Uno parent/child peers are absent; child Shape hit testing is disabled.
This establishes no shared announced Panel/Rectangle role. No external UIA,
screen reader or keyboard traversal was exercised.

Uno converts outer stage extents to integer physical bitmap dimensions:
25 logical becomes 31 physical at scale 1.25; HTML gives 38 at DPR 1.5.
The margins retain the complete Frame/child despite stage-edge rounding.
Partially intersected boundary pixels cannot isolate outside subpixel coverage,
so the clipping assertion concerns wholly outside pixel cells. Logical bounds
are independently measured; matching interior color does not imply equal edges.

No FigVam Preview/export, deeper nesting, hit-test clipping, transforms, other
colors/alphas/background compositing, fonts, strokes, radii, other browsers,
themes, desktop DPI, Uno heads or zero/large sizes were tested. HTML clipping
and the accessibility limits remain open research findings.
