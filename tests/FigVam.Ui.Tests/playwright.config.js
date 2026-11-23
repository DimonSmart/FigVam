const { defineConfig } = require('@playwright/test');

const slowMo = Number(process.env.FIGVAM_SLOWMO_MS ?? 0);
if (!Number.isInteger(slowMo) || slowMo < 0)
  throw new Error('FIGVAM_SLOWMO_MS must be a non-negative integer');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: process.env.CI ? 2 : 1,
  use: {
    browserName: 'chromium',
    launchOptions: { slowMo }
  }
});
