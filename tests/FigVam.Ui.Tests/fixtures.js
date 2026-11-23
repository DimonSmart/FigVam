const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const path = require('node:path');

const bearer = 'figvam-ui-test-token-only-at-loopback-5397';

async function startServer(testInfo, logName) {
  const project = path.resolve(__dirname, '../../src/FigVam.Server');
  const logPath = testInfo.outputPath(logName);
  const log = createWriteStream(logPath);
  const child = spawn('dotnet', [path.join(project, 'bin/Debug/net10.0/FigVam.Server.dll'),
    '--urls', 'http://127.0.0.1:0'], {
    cwd: project,
    windowsHide: true,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Development',
      Authentication__Mode: 'Local',
      Authentication__LocalDevelopment__Enabled: 'true',
      Authentication__LocalDevelopment__Token: bearer,
      Storage__Directory: testInfo.outputPath('storage'),
      // An end-to-end editing session can exceed 300 validated GETs/minute.
      RateLimiting__ReadPermitLimit: '3000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = new Promise(resolve => child.once('close', resolve));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  async function stop() {
    child.kill();
    await exited;
    await new Promise(resolve => log.end(resolve));
    await testInfo.attach(logName, { path: logPath, contentType: 'text/plain' });
  }
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
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

const test = base.extend({
  // Isolate documents, journal and the local actor's rate limit per scenario.
  server: [async ({}, use, testInfo) => {
    let instance = await startServer(testInfo, 'server.log');
    let restarts = 0;
    try {
      await use({
        get url() { return instance.url; },
        async restart() {
          await instance.stop();
          instance = null;
          instance = await startServer(testInfo, `server-restart-${++restarts}.log`);
        }
      });
    } finally {
      await instance?.stop();
    }
  }, { timeout: 60_000 }],
  baseURL: async ({ server }, use) => use(server.url)
});

module.exports = { test, expect, bearer };
