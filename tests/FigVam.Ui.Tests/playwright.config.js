const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: process.env.CI ? 2 : 1,
  use: { browserName: 'chromium' }
});
