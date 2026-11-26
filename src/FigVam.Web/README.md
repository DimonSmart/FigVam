# FigVam Web

Frontend source for FigVam's own interface, not the UI documents it renders.

Requirements: Node.js 22 (at least 22.12; current 22 LTS patch recommended), npm 11, the .NET SDK from the repository's global.json.

From this directory: `npm ci`, `npm run typecheck`, `npm run test`, `npm run build`.

The server project builds the frontend automatically and copies its generated assets into the ASP.NET output and publish directories. Generated assets are not committed. Run the application through the existing `aspire run` from the repository root. During migration, stable module names retain existing routes and the old editor uses the compiled transport/session modules. Vite is not a production server.

The Vite development server is not yet a replacement for the complete legacy editor. Run `npm run generate:api` to regenerate the committed API types from an isolated loopback ASP.NET server; `npm run generate:api -- --no-build --check` checks them after a Debug server build. The canonical schema uses the existing Local authentication mode; Google-only minimal endpoints need explicit client adapters. No production data or credentials are used.
