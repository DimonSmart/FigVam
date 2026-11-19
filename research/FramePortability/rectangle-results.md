# Static solid-fill Rectangle experiment — 2026-11-18

Research evidence for the open IDD-0014 candidate, bounded by IDD-0002.
This experiment does not register Rectangle, fill, alpha, or any Portable UI
Profile capability. No production code, Intent, or Engineering documents changed.
The original blank Frame probes are retained and run before each Rectangle case.

## Reproduction and environment

From `C:\Private\FigVam`, the actual command was:

```powershell
pwsh -NoProfile -File research/FramePortability/run.ps1 *> research/FramePortability/rectangle-run.log
Move-Item -LiteralPath research/FramePortability/rectangle-run.log -Destination research/FramePortability/rectangle-output.txt
```

Exit code: **0**. All four targets restored in locked mode, built and executed;
there were no platform skips, timeouts, or infrastructure failures. The complete
[captured output](rectangle-output.txt) includes the previous Frame calibration and
all Rectangle measurements. Decimal commas in HTML/WPF/Avalonia output reflect
the host culture; Uno emits decimal points.

The unchanged runner invokes these commands for each of `Html/Html.csproj`,
`Wpf/Wpf.csproj`, `Avalonia/FigVam.FrameResearch.Avalonia.csproj`, `Uno/Uno.csproj`:

```powershell
dotnet restore research/FramePortability/<project> --locked-mode
dotnet run --project research/FramePortability/<project> --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
```

Windows NT 10.0.26200.0; .NET SDK 10.0.204. Existing dependency versions and lock
files unchanged: Playwright 1.64.1, SkiaSharp 3.119.2, Avalonia 12.1.6,
Uno.Sdk 7.0.22 / locked Uno.WinUI 7.0.65. Edge/Chromium 157.0.4341.60.
WPF renders at 96 DPI; Avalonia uses its existing headless real Skia renderer
at 96 DPI; Uno runs the existing Skia Desktop/Win32 head in the interactive
Windows desktop at rasterization scale 1.25. HTML uses a 640×480 light viewport
at DPR 1, 1.5 and 2. No fonts/text occur in this experiment.

## Inputs and mappings

Each sample has exactly one static leaf Rectangle, no children, stroke, radius,
events or interactive role. The unchanged cases are 320×180, 123.5×67.25, 1×1
uiUnit. Each is separately rendered with RGB (64,128,192), first alpha 255,
then alpha 128. This tests brush alpha, not element/group opacity or compositing
against an opaque background.

| Target | Research mapping |
| --- | --- |
| HTML/CSS | Empty `div`, CSS width/height in px, `background:rgba(64,128,192,A/255)`, `pointer-events:none`, no role or tabindex. Body margin 0. Transparent screenshot background. |
| WPF | `System.Windows.Shapes.Rectangle`, Width/Height in DIP, `Fill="#FF4080C0"` / `"#804080C0"`, Focusable=False, IsHitTestVisible=False. Measure/Arrange at origin. RenderTargetBitmap Pbgra32 at 96 DPI. |
| Avalonia | `Avalonia.Controls.Shapes.Rectangle`, Width/Height in logical units, same ARGB Fill; UseLayoutRounding=False, Focusable=False, IsHitTestVisible=False. Measure/Arrange at origin, RenderTargetBitmap PNG at 96 DPI. |
| Uno | `Microsoft.UI.Xaml.Shapes.Rectangle`, same Width/Height and ARGB Fill; UseLayoutRounding=False on Rectangle and its containing Grid; left/top alignment, IsHitTestVisible=False. Loaded into the existing Window; RenderTargetBitmap at actual XamlRoot scale. |

## Bounds, fill and alpha measurements

All logical dimensions equal their inputs. HTML also asserts origin (0,0);
Avalonia asserts the full Bounds rectangle at origin. WPF asserts ActualWidth /
ActualHeight after arranging at origin. Uno asserts ActualWidth / ActualHeight
within 0.0001 uiUnit; all printed measurements equal the input exactly here.

`RectanglePixels.Check` checks **every fully covered captured pixel**: alpha
within 1 byte, unpremultiplied RGB within 2 bytes of the requested color. It also
requires at least one such pixel, checks maximum alpha within 1 byte and rejects
any captured pixel exceeding requested alpha + 1. WPF/Uno BGRA is explicitly
unpremultiplied; Skia PNG decoding provides straight RGBA. Every opaque interior
was exactly (64,128,192,255); every half-alpha interior was (64,128,191,128).
The one-byte blue difference follows 8-bit premultiplication/rounding. No blanket
cross-renderer edge equality is asserted. Unique captured colors and number of
verified interior pixels are in the log.

Bitmap sizes below follow case order **320×180 / 123.5×67.25 / 1×1**.
Alpha ranges include all captured pixels, listed as **opaque / half-alpha**.

| Target/scale | Bitmap sizes | Alpha ranges for the three cases |
| --- | --- | --- |
| HTML DPR 1 | 320×180 / 123×67 / 1×1 | 255 / 128; 255 / 128; 255 / 128 |
| HTML DPR 1.5 | 480×270 / 185×101 / 2×2 | 255 / 128; 127–255 / 64–128; 128–255 / 64–128 |
| HTML DPR 2 | 640×360 / 246×134 / 2×2 | 255 / 128; 255 / 128; 255 / 128 |
| WPF 96 DPI | 320×180 / 124×68 / 1×1 | 255 / 128; 32–255 / 16–128; 255 / 128 |
| Avalonia 96 DPI | 320×180 / 124×68 / 1×1 | 255 / 128; 0–255 / 0–128; 255 / 128 |
| Uno scale 1.25 | 400×225 / 154×84 / 1×1 | 255 / 128; 255 / 128; 255 / 128 |

There are 18 HTML Rectangle captures and six each for WPF, Avalonia and Uno:
**36 successful Rectangle captures**, in addition to retained blank Frame checks.

## Accessibility and non-interaction observations

| Target | Observed and asserted semantics |
| --- | --- |
| HTML | No authored ARIA role, tabindex=-1, no children, pointer-events none. Each full Chromium AX tree has unignored roles `RootWebArea,generic`; assertions reject button/textbox/checkbox/link/image roles. The generic node is not interpreted as an Image or a common Rectangle role. |
| WPF | Focusable=False and IsHitTestVisible=False verified; `UIElementAutomationPeer.CreatePeerForElement` returns null for every Rectangle. |
| Avalonia | Focusable=False and IsHitTestVisible=False verified; `ControlAutomationPeer.CreatePeerForElement` returns a peer with control type None for every Rectangle. |
| Uno | IsHitTestVisible=False verified; `FrameworkElementAutomationPeer.CreatePeerForElement` returns null for every Rectangle. Rectangle is a Shape, not a focusable Control; no independent keyboard focus traversal test was performed. |

These observations establish no shared announced accessibility role. Absence of
a WPF/Uno peer and Avalonia None do not establish equivalence with Chromium's
generic tree node. No external UIA client or screen reader was exercised.

## Failures, differences and limits

No assertion or target execution failed. The following measurement limitations
are material even though the bounded checks passed:

* Chromium clip conversion truncates fractional CSS extents before/while scaling:
  123.5×67.25 becomes 123×67 at DPR 1 and 246×134 at DPR 2. Therefore those
  captures establish interior color/alpha, not the complete fractional boundary.
* Uno crops its RenderTargetBitmap to integer physical dimensions: 154×84 rather
  than 154.375×84.0625, and 1×1 rather than 1.25×1.25. Uncaptured edge coverage is
  not measured. Logical geometry remains exact and separate from bitmap size.
* WPF fractional corner coverage gives alpha 32 (opaque) / 16 (half-alpha),
  whereas Avalonia includes fully transparent pixels. HTML DPR 1.5 also differs.
  The evidence does not imply pixel-identical edge rasterization.
* Capture is limited to the element extent. Overdraw outside it, hit-test routing,
  keyboard traversal, native accessibility tree integration, background
  compositing, and arbitrary colors/alphas are not established by these checks.
* No Preview FigVam, exported artifact pipeline, production profile registry,
  other browsers/themes/desktop DPI, other Uno heads, zero/large sizes, offsets,
  transforms, strokes, radii, clipping, children, text or interactions were tested.

The result is reproducible research at these inputs and rendering conditions;
it is not a declaration of Rectangle or profile support.
