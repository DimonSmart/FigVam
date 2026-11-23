const { defineConfig } = require('@playwright/test');

const demoMode = process.env.FIGVAM_DEMO === '1';
const slowMo = Number(process.env.FIGVAM_SLOWMO_MS ?? 0);
if (!Number.isInteger(slowMo) || slowMo < 0)
  throw new Error('FIGVAM_SLOWMO_MS must be a non-negative integer');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: process.env.CI ? 2 : 1,
  use: {
    browserName: 'chromium',
    viewport: demoMode ? null : { width: 1280, height: 720 },
    launchOptions: { slowMo, args: demoMode ? ['--start-maximized'] : [] }
  }
});
