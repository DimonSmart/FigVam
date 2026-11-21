const { test, expect } = require('./fixtures');

test('Google mode shows sign-in without a bearer input', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { mode: 'google' } }));
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: false } }));
  await page.goto('/');
  await expect(page.locator('#google-login')).toBeVisible();
  await expect(page.locator('#authentication-form')).toBeHidden();
  await expect(page.locator('#token')).toBeHidden();
  await expect(page.locator('#google-login')).toHaveAttribute('href', '/api/auth/login');
});

test('Google cookie session restores workspace and logout sends CSRF header', async ({ page }) => {
  let logoutCsrf = null;
  await page.route('**/api/auth/config', route => route.fulfill({ json: { mode: 'google' } }));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, csrfToken: 'controlled-test-csrf', actorId: 'google:test', email: 'test@example.com', admin: false
  } }));
  await page.route('**/api/v1/documents?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/api/auth/logout', route => {
    logoutCsrf = route.request().headers()['x-csrf-token'];
    return route.fulfill({ json: { signedOut: true } });
  });
  await page.goto('/');
  await expect(page.locator('#authentication')).toBeHidden();
  await expect(page.locator('#documents-view')).toBeVisible();
  await page.locator('#disconnect').click();
  await expect(page.locator('#google-login')).toBeVisible();
  expect(logoutCsrf).toBe('controlled-test-csrf');
});
