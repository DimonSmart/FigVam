const { defineConfig } = require('@playwright/test');
module.exports=defineConfig({testDir:'.',testMatch:'frontend-performance.bench.js',workers:1,repeatEach:3,
  use:{browserName:'chromium',viewport:{width:1800,height:1100},colorScheme:'light'}});
