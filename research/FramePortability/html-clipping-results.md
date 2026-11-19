# HTML/CSS clipping mapping comparison — 2026-11-18

Bounded research for IDD-0002/0005/0014, following the strict failure in
[nested-results.md](nested-results.md). No production capability or support is
declared. Existing probes, cases, dependency locks, profile declarations, Intent,
Engineering and other existing work remain unchanged.

## Result

**216 captures executed: 208 passed, eight failed.** The 108 visible-overflow
positive controls passed. Of 108 clipped captures, 100 passed and eight failed.
Both mappings using `clip-path:inset(0)` passed all 18 clipped samples each,
including both alpha values at every size and DPR. This is evidence for these
specific samples and renderer, not general clipping or profile support.

Each mapping has 18 clipped captures (3 sizes × 3 DPR × 2 alpha values) plus
18 separately rendered visible controls. The control replaces the candidate
CSS with `overflow:visible`, removing its clipping declaration entirely.

| Mapping | CSS on clipped Frame | Clip pass | Clip failures |
| --- | --- | --- | --- |
| overflow-hidden | `overflow:hidden` | 16/18 | Fractional Frame, DPR 2, both alpha values |
| overflow-clip | `overflow:clip` | 16/18 | Same |
| clip-path-inset | `overflow:visible;clip-path:inset(0)` | 18/18 | None measured |
| hidden-and-clip-path | `overflow:hidden;clip-path:inset(0)` | 18/18 | None measured |
| contain-paint | `overflow:visible;contain:paint` | 16/18 | Same as overflow-hidden |
| hidden-composited | `overflow:hidden;transform:translateZ(0)` | 16/18 | Same as overflow-hidden |

For each failing sample, all **33,098 fully covered interior pixels** matched,
while **134 wholly outside pixels** painted. The opaque sample paints alpha
255; the half-alpha sample paints alpha 128. Thus neither `overflow:clip`,
paint containment nor forcing a transform eliminated the observed failure.
The baseline reproduces the previous 134-pixel discrepancy. This experiment
does not establish the browser's internal cause.

For both clip-path mappings, every checked interior matched and every wholly
outside pixel had zero alpha across all 18 samples. For the critical
123.5×67.25 case at DPR 2, this means 33,098 interior and 21,119 wholly outside
pixels checked per alpha value, with **zero** interior or outside differences.
Every other mapping also had zero interior differences; all remaining clipped
samples had zero outside differences.

## Reproduction and harness

From `C:\Private\FigVam` on Windows with PowerShell 7, the repository's .NET SDK,
NuGet access and installed Edge:

```powershell
pwsh -NoProfile -File research/FramePortability/run-html-clipping.ps1 *> research/FramePortability/html-clipping-output.txt
```

The command intentionally returns **nonzero** because it retains the failing
baseline and other candidates. The underlying `dotnet run` exited
**-532462766** after `ThrowIfNestedFailures` reported eight strict failures;
PowerShell exited 1. No sample was skipped after a clipping failure. The full
[output](html-clipping-output.txt) includes every measurement, requested and
computed CSS, AX roles, and final exception.

[run-html-clipping.ps1](run-html-clipping.ps1) creates a unique temporary
directory containing an exact copy of existing `Html/Html.csproj`, its
`packages.lock.json` and the original `RectanglePixels.cs`. Only the entry point
is replaced in that temporary directory by
[HtmlClippingProbe.cs](HtmlClippingProbe.cs). It executes:

```powershell
dotnet restore <temporary>/Html/Html.csproj --locked-mode
dotnet run --project <temporary>/Html/Html.csproj --no-restore -- C:\Private\FigVam\research\FramePortability\cases.json
```

The project and linked checker are copied without editing, and the original
case file is read directly. Temporary files remain available for inspection;
the runner does not delete directories. Each subprocess has a 180-second
timeout that terminates the process tree and fails the experiment.
The original `run.ps1` and HTML entry point are unchanged and retain their
previous strict failing result. This separate harness runs only the nested
visible/clip samples needed for this comparison; it does not rerun the blank
Frame/calibration, standalone Rectangle or offset probes.

Locked restore passed. Measured environment: Windows NT 10.0.26200.0,
.NET runtime 10.0.15, Edge/Chromium 157.0.4341.60; locked Playwright 1.64.1
and SkiaSharp 3.119.2. Original HTML dependency lock SHA-256:
`64A6A8769F17F5C02F976E469269AB8E6AA44EE48273E43383D2518683595E43`.
Viewport 640×480, light color scheme, DPR 1, 1.5 and 2.

## Geometry, controls and strict assertions

Unchanged cases: **320×180, 123.5×67.25 and 1×1** CSS px. The Frame is at
(8,8) on a transparent stage sized ceil(width)+24 by ceil(height)+24. The
absolute child is at (-2.25,-3.375), sized (width+4.5,height+6.75), with fill
RGB (64,128,192), alpha 255 or 128, no stroke/radius, and pointer-events:none.
Exact measured Frame and child bounds were asserted for every capture.
No authored role or focus stop is added; Chromium AX assertions reject
button/textbox/checkbox/link/image roles. Unignored AX roles remained
RootWebArea,generic,generic,generic.

The unchanged `RectanglePixels.CheckNested` checks every fully covered clipped
interior pixel (alpha within one byte; RGB within two bytes) and demands
**exact alpha zero** for every pixel cell wholly outside the logical Frame.
Clip checks have no inset and no outside tolerance. All pixels are scanned;
the capture margin prevents crop boundaries from masquerading as clipping.
Every visible control must paint wholly outside the Frame; observed counts
ranged from **34 to 10,656** per capture. Its interior uses the existing one
logical unit inset, retaining separate geometric fringe counts in the output.
No assertion or checker tolerance was changed.

The following checked coverage is identical across candidates and alpha values.
Sizes in each cell follow the input order 320×180 / 123.5×67.25 / 1×1.

| DPR | Stage bitmap dimensions | Clipped interior pixels | Wholly outside pixels checked |
| --- | --- | --- | --- |
| 1 | 344×204 / 148×92 / 25×25 | 57,600 / 8,241 / 1 | 12,576 / 5,184 / 624 |
| 1.5 | 516×306 / 222×138 / 38×38 | 129,600 / 18,500 / 1 | 28,296 / 11,850 / 1,440 |
| 2 | 688×408 / 296×184 / 50×50 | 230,400 / 33,098 / 4 | 50,304 / 21,119 / 2,496 |

## Limits

The comparison establishes only the stated geometric/pixel assertions for one
installed Edge build and these inputs. Boundary-straddling pixels may have
partial coverage; a wholly outside pixel check cannot determine subpixel
outside coverage within those cells. The output preserves edge RGBA values;
matching the strict check does not establish equal edge rasterization.

No browser internals, other browsers/versions, themes, background compositing,
additional alpha/color values, Frame positions, transforms beyond the explicit
candidate, strokes, radii, scroll behavior, hit-test clipping, deep nesting,
keyboard/screen-reader behavior, FigVam Preview/export, or native targets were
tested. `clip-path`, containment and transforms can affect other behavior; this
experiment makes no claim about those behaviors. No production mapping or
portable profile was selected or changed.

All pre-existing tracked and untracked nonignored file contents were checked
against a before-run SHA-256 snapshot and remained identical. Scoped
CRLF-aware Git whitespace validation passed. The four added files are this
report, the comparison source, its runner and the complete output.
