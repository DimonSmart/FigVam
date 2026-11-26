const { test, expect } = require('./fixtures');

test('the editor shell loads every script and mounts the authentication view', async ({ page, server }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.resourceType() === 'script') errors.push(request.url() + ': ' + request.failure()?.errorText);
  });
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.status() >= 400)
      errors.push(response.url() + ': ' + response.status());
  });
  try {
    await page.goto(server.url);
    await expect(page.getByLabel('Bearer-токен', { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('frontend-bootstrap-errors', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});
