# FigVam Web

Frontend source for FigVam's own interface, not the UI documents it renders.

Requirements: Node.js 22 (at least 22.12; current 22 LTS patch recommended), npm 11, the .NET SDK from the repository's global.json.

From this directory: `npm ci`, `npm run typecheck`, `npm run test`, `npm run build`.

The server project builds the frontend automatically and copies its generated assets into the ASP.NET output and publish directories. Generated assets are not committed. Run the application through the existing `aspire run` from the repository root. During migration, stable module names retain existing routes and the old editor uses the compiled transport/session modules. Vite is not a production server.

The Vite development server is not yet a replacement for the complete legacy editor. OpenAPI generation is configured but requires the specification and CI synchronization to be implemented in the next migration stage.
