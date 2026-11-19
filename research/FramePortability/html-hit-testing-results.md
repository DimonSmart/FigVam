# HTML clipping hit-testing — 2026-11-18

This bounded research extends [the clipping comparison](html-clipping-results.md). It does not establish production or portable-profile support.

Both `overflow:visible;clip-path:inset(0)` and `overflow:hidden;clip-path:inset(0)` passed **18/18 clipped samples**. In all samples, the Frame interior hit the Rectangle and the outside point did not hit the Rectangle (it hit `stage`). Each mapping's **18/18 visible-overflow controls** hit the Rectangle at both points. Each count covers three sizes, three DPRs and two alpha values. All **72/72 visual pixel checks** also passed, including 36 clipped and 36 visible controls. There were no observed failures.

The Frame sizes are 320×180, 123.5×67.25 and 1×1 CSS px; DPRs are 1, 1.5 and 2. The Frame begins at (8,8); the Rectangle begins at (-2.25,-3.375) relative to it and exceeds its size by (4.5,6.75). The inside point is the Frame centre, strictly inside both elements even for 1×1. The outside point is (7,7), one CSS px above and left of the Frame and strictly inside the overflowing Rectangle. The harness asserts these geometry conditions and computed `pointer-events:auto`. After the original screenshot and strict `RectanglePixels.CheckNested` checks with `pointer-events:none`, it enables pointer events and calls `document.elementFromPoint` for both points. Visible controls remove the clipping CSS and require the outside hit to be the child; clipped cases require it not to be the child. The fill alpha values are 255 and 128. Bounds, accessibility role, and visual assertions remain active as in the previous probe.

Run from the repository root with Windows, PowerShell 7, the repository .NET SDK, locked dependencies and installed Edge:

```powershell
pwsh -NoProfile -File research/FramePortability/run-html-hit-testing.ps1
```

[The runner](run-html-hit-testing.ps1) copies the existing HTML project, lock and pixel checker into a unique temporary directory, installs [the separate probe](HtmlHitTestingProbe.cs) as its entry point, restores in locked mode, and reads the unchanged case file. It returns nonzero for a hit-test or pixel assertion failure. The [final output](html-hit-testing-final-output.txt) records every sample and the successful run; the [initial output](html-hit-testing-output.txt) records the same successful checks before the expected-result label was made more precise. Neither overwrites earlier research output.

Environment: Edge/Chromium 157.0.4341.60, Windows NT 10.0.26200.0, .NET 10.0.15, locked Playwright 1.64.1, viewport 640×480, light scheme. HTML lock SHA-256 `64A6A8769F17F5C02F976E469269AB8E6AA44EE48273E43383D2518683595E43`.

The observation is limited to `elementFromPoint` at these two coordinates and this browser/build, geometry and CSS. It does not test dispatched pointer events, pointer capture, keyboard interaction, other positions or shapes, deeper nesting, transforms, other browsers or native targets. Boundary-straddling pixel coverage and other limits in the previous report still apply. No profile or support declaration follows.
