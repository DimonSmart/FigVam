const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const path = require('node:path');

const bearer = 'figvam-ui-test-token-only-at-loopback-5397';

const test = base.extend({
  // Local authentication has one actor. Isolate its real rate-limit budget,
  // documents and journal per scenario instead of sharing process state.
  serverURL: [async ({}, use, testInfo) => {
    const project = path.resolve(__dirname, '../../src/FigVam.Server');
    const logPath = testInfo.outputPath('server.log');
    const log = createWriteStream(logPath);
    const child = spawn('dotnet', [path.join(project, 'bin/Debug/net10.0/FigVam.Server.dll'),
      '--urls', 'http://127.0.0.1:0'], {
      cwd: project,
      windowsHide: true,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Development',
        Authentication__LocalDevelopment__Enabled: 'true',
        Authentication__LocalDevelopment__Token: bearer,
        Storage__Directory: testInfo.outputPath('storage')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const exited = new Promise(resolve => child.once('close', resolve));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Server startup exceeded 60 seconds; see ${logPath}`)), 60_000);
        let pending = '';
        child.stdout.on('data', chunk => {
          pending += chunk.toString();
          const lines = pending.split('\n');
          pending = lines.pop();
          for (const line of lines) {
            let entry;
            try { entry = JSON.parse(line); } catch { continue; }
            if (entry.Category === 'Microsoft.Hosting.Lifetime' && entry.EventId === 14) {
              clearTimeout(timer);
              resolve(entry.State.address);
            }
          }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => {
          clearTimeout(timer);
          reject(new Error(`Server exited with code ${code}; see ${logPath}`));
        });
      });
      const health = await fetch(`${url}/health`);
      expect(health.status, `Server health at ${url}; see ${logPath}`).toBe(200);
      await health.text();
      await use(url);
    } finally {
      child.kill();
      await exited;
      await new Promise(resolve => log.end(resolve));
      await testInfo.attach('server log', { path: logPath, contentType: 'text/plain' });
    }
  }, { timeout: 60_000 }],
  baseURL: async ({ serverURL }, use) => use(serverURL)
});

module.exports = { test, expect, bearer };
