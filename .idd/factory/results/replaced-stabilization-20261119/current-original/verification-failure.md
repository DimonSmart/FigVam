check/command
`npm test` (working directory: `tests/FigVam.Ui.Tests`)

exit result
1; 46 passed, 1 failed.

bounded relevant diagnostic
`screen-resize.spec.js:48:1` — expected `#screen-size-error` to contain `Нет доступа`, received empty string after mocked resize-screen 403. Other 46 Playwright tests passed. Worker’s previous run reported 47/47; this root rerun is the retained failure. Server build passed separately with 0 warnings/errors.


check/command
`npm test` (working directory: `tests/FigVam.Ui.Tests`), after resize refusal correction.

exit result
1; 46 passed, 2 failed.

bounded relevant diagnostic
All 8 `screen-resize.spec.js` tests passed. `editor.spec.js:316:1` failed because `#version-error` was empty while the test expected `Нет доступа`; `editor.spec.js:405:1` failed because `#restore-error` was empty while the test expected `конфликтует`. Worker reported focused resize 8/8 and Server build 0 warnings/errors. This full-run failure is retained for fresh Planner assessment.