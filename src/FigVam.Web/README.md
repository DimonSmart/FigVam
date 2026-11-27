# FigVam Web

Frontend source for FigVam's own interface, not the UI documents it renders.

Requirements: Node.js 22 (at least 22.12), npm 11, and the .NET SDK from the repository's global.json.

From this directory: `npm ci`, `npm run typecheck`, `npm run test`, `npm run build`. The ASP.NET project builds the frontend and copies generated assets into its output and publish directories. Generated assets are not committed. Run the application via `aspire run` from the repository root or the ASP.NET server. Vite is not a production server.

## Modules and ownership

- `app/editor.ts`: composition root and application lifecycle coordinator; wires feature controllers, browser navigation and the open document lifecycle. Role and title are owned by the document shell model; page/screen selection, catalog cursors and revisions have separate owners.
- `app/application-shell-state.ts`: route visibility, foreground feedback, catalog presentation, create/import drafts and file-picker reset state. `features/home/document-creation.ts` owns creation and import transport and session-scoped import operations.
- `app/document-shell-state.ts`: current document role/title, document rename draft, page-command busy state, screen form and deletion presentation. Feature controllers use the workspace visibility callback rather than DOM visibility.
- `app/document-catalog.ts`: catalog cursor and pagination ownership; `app/workspace-selection.ts`: page/screen selection and rename drafts.
- `api/document-commands.ts`: typed command-name, request and response mapping from OpenAPI. Prepared operations own the command ID and serialized payload, validate acknowledgements, prevent parallel sends and distinguish confirmed, rejected, conflict and uncertain outcomes. Synchronization is tracked separately from confirmation. Feature-specific validation and reconciliation remain in their controllers.
- `app/document-workspace.ts`: confirmed document revision, full catalog revision and revision-pinned page/screen selection reconciliation.
- `app/request-runner.ts`: foreground operation lifecycle, cancellation, retry and restart of collaboration; the view supplies busy/status callbacks.
- `app/navigation.ts`: document route parsing, history and dirty-draft navigation guard.
- `features/home/session-authentication.ts`: validated authentication configuration and session transport.
- `core/session.ts`: a session lifecycle instance owns the in-memory authentication token, session/navigation epochs and the foreground cancellation scope. API requests also observe the session lifetime. Features receive explicit context dependencies.
- `api/`: transport, generated OpenAPI DTOs, checked decoders and typed revision-pinned document queries; `app/page-commands.ts` owns page/screen operations and retries; `app/document-mutations.ts` owns document rename and deletion, including catalog deletion. `api/command-value-contracts.ts` converts frontend draft values to generated DTOs.
- `features/`: domain-specific controllers and React views. Each feature owns its drafts, validation, operation state and retry policy. Collaboration owns the live subscription, layers own layer selection, and the confirmed document revision has an explicit owner in the workspace.
- `app/application-root.ts`: one React root and a single bootstrap mount. `app/application-shell.tsx` and `features/editor/editor-shell.tsx` declare the complete shell in JSX. `app/application-views.ts` composes typed feature models; `app/view-model.tsx` subscribes directly at the declared component position via `useSyncExternalStore`. No application portals or DOM reparenting are used. Application and document shell, creation/import, presence settings, export/history, layer metadata and command feedback, token/style forms, inspector/palette, asset operations, interaction editor and Preview chrome are model-backed. Controllers must not change the children of React-owned views. Menu selection lives in a shared typed editor-menu model. Native popover positioning, focus and measurement still use DOM APIs. Feature components are memoized to avoid re-rendering unrelated subscriptions when shell state changes.
- `features/editor/drawing-tools.tsx`: React-owned toolbar using Lucide icons and direct palette actions; palette fields use the shared React property editors.
- `app/preview-chrome.ts` and `app/canvas-chrome.ts`: observable projections of renderer feedback, Preview mode and toolbar state. Native renderer/viewport own geometry, pan and scale; only rounded scale changes reach the toolbar. A synchronous mode transition is needed before measuring or focusing the visible Preview host.
- `canvas/`: independent rendering, hit testing, viewport, drag and export logic; it does not import React, UI Kit or application controllers. `canvas/chrome-contracts.ts` defines the narrow renderer-to-chrome contracts. DOM inside renderer hosts is engine-owned; chrome outside the hosts is React-owned.
- `ui/`: reusable application controls; see [UI Kit](UI-KIT.md).

Vite has two entries: `editor.js` and `headless-preview.js`. Shared chunks are generated automatically. ASP.NET permits the editor entry and generated chunks; the headless entry is copied to the isolated preview renderer rather than exposed as a public editor route.

Run `npm run generate:api` to regenerate the committed API types from an isolated loopback ASP.NET server; `npm run generate:api -- --no-build --check` checks them after a Debug server build. The canonical schema uses Local authentication mode; Google-only minimal endpoints need explicit client adapters. No production data or credentials are used.

## Regression verification

The repository CI runs frontend typecheck/build/tests, generated-contract comparison, server build/publish and tests, published asset route checks, MCP smoke, Aspire tunnel lifecycle and Playwright (including Login Prototype E2E). Architecture tests prohibit handwritten runtime JavaScript, more than one application React root, direct application portals or legacy panel adapters, React/UI/application imports in the rendering engine, direct document-command URLs outside the command module, explicit any, disabled type checking, runtime import cycles and feature imports of the composition root. The presence of a successful frontend job does not replace full CI. The shell ownership architecture check prevents regression to direct ID-based access for migrated fields. Frontend comparison builds the PR base and candidate on one runner using identical benchmarks. Visual and performance comparisons require matching baseline and candidate runs; do not claim them from typecheck alone. Never raise thresholds only to pass CI.

## Extending the frontend

- New panel: define a typed view and actions in the feature, create a view model, and mount its Component at a declared position in the existing shell. Keep drafts in a single owner. Avoid publishing a new snapshot when no data changed.
- New document command: use `createDocumentCommand(documentId, name, data)` or `prepareDocumentCommand` for an already assigned command ID. The request type is inferred from the endpoint. Convert special frontend values with explicit adapters; validate additional acknowledgement fields in the feature if needed. Store the prepared operation for the user's intent, execute it with context guards, and reconcile the document only after a valid acknowledgement. Retry an uncertain write with the same serialized body. Retry a confirmed-but-unsynchronized operation by reading, never by writing again. Resolve conflicts using current document state and a deliberate new intent.
- New property editor: extend the typed value/field specification and the existing property editor, retaining local preview and automatic application. Do not add Apply buttons for ordinary properties.
- New state: identify the authoritative owner (session, workspace revision, selection, feature draft, operation or UI state). Project derived values into views; never use a DOM attribute or a label as the source of a revision or permission. Cancel or invalidate asynchronous work on context change. Dispose subscriptions, timers and browser resources with their owner.
- New common control: reuse UI Kit and Base UI when they provide actual behavioral/accessibility value. Use Lucide for standard icons. Reserve native DOM integration for focus, positioning, files, browser APIs, and engine-owned rendering. Use synchronous React rendering only at a required immediate geometry/focus boundary.
- Verification: run typecheck, tests, build, generated-contract check and full CI including Playwright and Frontend comparison. Architecture and performance budgets must not be weakened to make a change pass.

## State ownership and operation lifetimes

| State | Authoritative owner |
| --- | --- |
| Authentication mode and CSRF | Instance of the authentication client, injected into API consumers |
| Session identity, session and navigation cancellation | Session state |
| Active document, revision, selection | Composition root bindings, document revision and workspace selection models |
| Shell, editor chrome, layer move availability | Application and document shell models; React subscribes to snapshots |
| Resource and inspector drafts | Feature controllers; transient input is not read back from rendered DOM |
| Command ID, immutable prepared payload, outcome | Prepared document operation |
| Collaboration and presence | Document-scoped controllers; collaboration rechecks membership on HEARTBEAT |

Navigation cancels document reads; the foreground request lane must not abort independent command confirmation. A known server rejection remains a rejection even when its originating UI context is obsolete. A stale result must not update a new workspace. Downgrade to Viewer discards pending edits for the current document. Native DOM use is limited to canvas rendering, geometry, focus, browser APIs and positioning.

Token and layer views are separate from their controllers. Token/style validation, interaction model and scenario serialization, and node command payload preparation have dedicated modules. The comparison workflow captures the existing visual states and measures five post-GC heap checkpoints across 20 additional navigation cycles in one browser session. Sustained growth above the checkpoint heuristic produces a heap snapshot and requires investigation. The existing timing and bundle budgets remain unchanged. A passing pixel comparison is not manual visual approval.

The catalog/open-document read workflow is owned by `app/workspace-navigation.ts`; the composition root binds lifecycle resets and state publication. The selected page's empty status is derived from the workspace model; DOM queries in popup positioning are geometry-only.

Style drafts are scoped to the document and selected style while the workspace is open. Refreshes rebase untouched fields on current server values; changing selection preserves local edits. The comparison waits for transient status notifications to expire, because PR #37's 0.38% Styles difference was the four-second `Страницы обновлены.` toast, not style rendering.

Post-command synchronization for layer metadata/move/delete, history, visual nodes, screen size/variants and scenarios uses the document navigation signal instead of the foreground request lane. Foreground navigation remains latest-wins; independent synchronization still checks document, revision and selection before publication.

Feature-local reads in Components, Datasets, screen variants and token usages have independent cancellation scopes, reset on document change or superseded selection. Dataset and variant confirmations preserve a newer selection. Pending automatic token value changes are keyed by token and theme, not theme alone; selection/filter refresh cannot discard queued writes.
