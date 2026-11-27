# FigVam Web

Frontend source for FigVam's own interface, not the UI documents it renders.

Requirements: Node.js 22 (at least 22.12), npm 11, and the .NET SDK from the repository's global.json.

From this directory: `npm ci`, `npm run typecheck`, `npm run test`, `npm run build`. The ASP.NET project builds the frontend and copies generated assets into its output and publish directories. Generated assets are not committed. Run the application via `aspire run` from the repository root or the ASP.NET server. Vite is not a production server.

## Modules and ownership

- `app/editor.ts`: application coordinator; owns document identity, role, committed revision, page/screen selection and the document list cursor.
- `core/session.ts`: in-memory authentication token, navigation epoch and cancellation of the current request.
- `api/`: transport, generated OpenAPI DTOs, checked decoders and typed revision-pinned document queries; `app/page-commands.ts` builds page/screen commands.
- `features/`: domain-specific controllers and React views. Each feature owns its drafts, validation, operation state and retry policy. Collaboration owns the live subscription, layers own layer selection, and the document revision is authoritative in the coordinator.
- `app/react-panels.tsx`: a single React root with separately subscribed portal slots. This is a migration adapter for the existing HTML shell, not a second application or a final component hierarchy. Legacy controls must not change children inside React-owned slots. The remaining imperative shell and specialized property/token controls still need conversion before the full migration is complete.
- `canvas/`: independent rendering, hit testing, viewport, drag and export logic; it does not import React.
- `ui/`: reusable application controls; see [UI Kit](UI-KIT.md).

Vite has two entries: `editor.js` and `headless-preview.js`. Shared chunks are generated automatically. ASP.NET permits the editor entry and generated chunks; the headless entry is copied to the isolated preview renderer rather than exposed as a public editor route.

Run `npm run generate:api` to regenerate the committed API types from an isolated loopback ASP.NET server; `npm run generate:api -- --no-build --check` checks them after a Debug server build. The canonical schema uses Local authentication mode; Google-only minimal endpoints need explicit client adapters. No production data or credentials are used.

## Regression verification

The repository CI runs frontend typecheck/build/tests, generated-contract comparison, server build/publish and tests, published asset route checks, MCP smoke, Aspire tunnel lifecycle and Playwright (including Login Prototype E2E). The presence of a successful frontend job does not replace full CI. Visual and performance comparisons require matching baseline and candidate runs; do not claim them from typecheck alone.
