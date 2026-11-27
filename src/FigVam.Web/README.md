# FigVam Web

Frontend source for FigVam's own interface, not the UI documents it renders.

Requirements: Node.js 22 (at least 22.12), npm 11, and the .NET SDK from the repository's global.json.

From this directory: `npm ci`, `npm run typecheck`, `npm run test`, `npm run build`. The ASP.NET project builds the frontend and copies generated assets into its output and publish directories. Generated assets are not committed. Run the application via `aspire run` from the repository root or the ASP.NET server. Vite is not a production server.

## Modules and ownership

- `app/editor.ts`: application coordinator; composes feature controllers and browser views. Document identity, role, page/screen selection and list pagination still reside here during migration.
- `app/document-workspace.ts`: confirmed document revision, full catalog revision and revision-pinned page/screen selection reconciliation.
- `app/request-runner.ts`: foreground operation lifecycle, cancellation, retry and restart of collaboration; the view supplies busy/status callbacks.
- `app/navigation.ts`: document route parsing, history and dirty-draft navigation guard.
- `features/home/session-authentication.ts`: validated authentication configuration and session transport.
- `core/session.ts`: in-memory authentication token, navigation epoch and cancellation of the current request.
- `api/`: transport, generated OpenAPI DTOs, checked decoders and typed revision-pinned document queries; `app/page-commands.ts` builds page/screen commands.
- `features/`: domain-specific controllers and React views. Each feature owns its drafts, validation, operation state and retry policy. Collaboration owns the live subscription, layers own layer selection, and the confirmed document revision has an explicit owner in the workspace.
- `app/application-root.ts`: one React root and a single bootstrap mount. `app/application-shell.tsx` and `features/editor/editor-shell.tsx` declare the complete shell in JSX. `app/application-views.ts` composes typed feature models; `app/view-model.tsx` subscribes directly at the declared component position via `useSyncExternalStore`. No application portals or DOM reparenting are used. Remaining imperative inspector fields and some form state still require migration; controllers must not change the children of React-owned views.
- `features/editor/drawing-tools.tsx`: React-owned toolbar using Lucide icons and direct palette actions; legacy palette fields remain a separate migration item.
- `canvas/`: independent rendering, hit testing, viewport, drag and export logic; it does not import React.
- `ui/`: reusable application controls; see [UI Kit](UI-KIT.md).

Vite has two entries: `editor.js` and `headless-preview.js`. Shared chunks are generated automatically. ASP.NET permits the editor entry and generated chunks; the headless entry is copied to the isolated preview renderer rather than exposed as a public editor route.

Run `npm run generate:api` to regenerate the committed API types from an isolated loopback ASP.NET server; `npm run generate:api -- --no-build --check` checks them after a Debug server build. The canonical schema uses Local authentication mode; Google-only minimal endpoints need explicit client adapters. No production data or credentials are used.

## Regression verification

The repository CI runs frontend typecheck/build/tests, generated-contract comparison, server build/publish and tests, published asset route checks, MCP smoke, Aspire tunnel lifecycle and Playwright (including Login Prototype E2E). Architecture tests prohibit handwritten runtime JavaScript, more than one application React root, direct application portals or legacy panel adapters, and React imports in the rendering engine. The presence of a successful frontend job does not replace full CI. Visual and performance comparisons require matching baseline and candidate runs; do not claim them from typecheck alone.
