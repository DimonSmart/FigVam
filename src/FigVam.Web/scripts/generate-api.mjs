import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = resolve(root, '../FigVam.Server');
const output = join(root, 'src/api/schema.generated.ts');
const check = process.argv.includes('--check');
const noBuild = process.argv.includes('--no-build');
if (!noBuild) {
  const build = spawnSync('dotnet', ['build', server], { stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('Server build failed');
}

const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
const baseUrl = 'http://127.0.0.1:' + port;
const storage = await mkdtemp(join(tmpdir(), 'figvam-openapi-'));
const token = 'figvam-openapi-isolated-development-token';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:(?:ASPNETCORE_|DOTNET_)?Authentication__|Kestrel__|McpTunnel__|Mcp__|DOTNET_ENVIRONMENT$|ASPNETCORE_HTTP_PORTS$|ASPNETCORE_HTTPS_PORTS$)/i.test(key)));
Object.assign(env, {
  ASPNETCORE_ENVIRONMENT: 'Development',
  ASPNETCORE_URLS: baseUrl,
  Authentication__Mode: 'Local',
  Authentication__LocalDevelopment__Enabled: 'true',
  Authentication__LocalDevelopment__Token: token,
  Storage__Directory: storage,
});
let child;
let logs = '';
try {
  child = spawn('dotnet', [join(server, 'bin/Debug/net10.0/FigVam.Server.dll')], { cwd: server, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('Server exited: ' + logs);
    try {
      if ((await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch { /* retry during startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Server readiness timed out: ' + logs);
  const response = await fetch(baseUrl + '/openapi/v1.json', {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('OpenAPI request failed: ' + response.status);
  const schema = await response.json();
  const types = astToString(await openapiTS(schema, { alphabetize: true }));
  const generated = '// Generated from the FigVam ASP.NET OpenAPI contract. Do not edit.\n' + types;
  if (check) {
    const committed = await readFile(output, 'utf8');
    if (committed.replaceAll('\r\n', '\n') !== generated.replaceAll('\r\n', '\n')) {
      const candidate = join(storage, 'schema.generated.ts');
      await writeFile(candidate, generated, 'utf8');
      spawnSync('git', ['diff', '--no-index', '--ignore-cr-at-eol', '--', output, candidate], { stdio: 'inherit' });
      throw new Error('API types are stale. Run npm run generate:api and commit the result.');
    }
  } else {
    await writeFile(output, generated, 'utf8');
  }
} finally {
  if (child?.pid && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await rm(storage, { recursive: true, force: true });
}
