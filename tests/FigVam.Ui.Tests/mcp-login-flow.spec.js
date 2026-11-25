const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { verifyLoginVisual } = require('./login-visual');

async function connect(request, endpoint, token) {
  let id = 0;
  let protocolVersion;
  async function rpc(method, params, notification = false) {
    const response = await request.post(endpoint, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) },
      data: { jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params }
    });
    expect(response.ok(), 'MCP ' + method + ': HTTP ' + response.status()).toBeTruthy();
    if (notification) return;
    const body = await response.text();
    const message = body.startsWith('{') ? JSON.parse(body) :
      body.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(message => message.id === id);
    expect(message?.error).toBeUndefined();
    return message.result;
  }
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'FigVam UI acceptance', version: '1' } });
  protocolVersion = initialized.protocolVersion;
  await rpc('notifications/initialized', {}, true);
  expect((await rpc('tools/list', {})).tools.length).toBe(31);
  const raw = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  const call = async (name, args = {}) => {
    const result = await raw(name, args);
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
    return result.structuredContent;
  };
  call.raw = raw;
  return call;
}

async function signIn(page, server) {
  await page.goto(server.url);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

async function grant(page) {
  await page.locator('#mcp-access-menu summary').click();
  await page.getByRole('button', { name: 'Разрешить', exact: true }).click();
  const secret = page.getByLabel('Токен доступа', { exact: true });
  await expect(secret).toBeVisible();
  await expect(secret).toHaveAttribute('type', 'password');
  const token = await secret.inputValue();
  const endpoint = await page.getByLabel('Адрес MCP-сервера').inputValue();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Копировать токен', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())) === token).toBe(true);
  await page.getByRole('button', { name: 'Копировать конфигурацию MCP' }).click();
  await expect.poll(async () => {
    try { const config = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      return config.mcpServers.figvam.url === endpoint && config.mcpServers.figvam.headers.Authorization === 'Bearer ' + token;
    } catch { return false; }
  }).toBe(true);
  await page.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(secret).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Скрыть', exact: true }).click();
  await page.locator('#mcp-access-menu summary').click();
  await expect(secret).toHaveCount(0);
  return { token, endpoint };
}

test('MCP builds the login prototype, both editors see changes and restart invalidates access', async ({ page, request, server, browser }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('MCP Login Prototype');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const documentPath = new URL(page.url()).pathname;
  const read = async () => {
    const response = await request.get(server.url + '/api/v1' + documentPath + '/document.json', { headers: { Authorization: 'Bearer ' + bearer } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).document;
  };
  const { token, endpoint } = await grant(page);
  const call = await connect(request, endpoint, token);
  const second = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  try {
    await signIn(second, server);
    await second.getByRole('link', { name: 'MCP Login Prototype' }).click();
    await expect(second).toHaveURL(/\/documents\/[0-9a-f-]+$/);

    const { pageId } = await call('create_page');
    await call('rename_page', { pageId, name: 'Login flow' });
    const { screenId: loginScreen } = await call('create_screen', { pageId, width: 800, height: 600 });
    await call('rename_screen', { screenId: loginScreen, name: 'Login' });
    const create = async (parentId, kind, properties) => (await call('create_node', { parentId, kind, properties })).nodeId;
    const background = await create(loginScreen, 'Frame', { x: 0, y: 0, width: 800, height: 600, backgroundColor: '#EEF2F7', borderWidth: 0, cornerRadius: 0 });
    const { tokenId } = await call('create_token', { name: 'spacing.dialog', type: 'Spacing', light: 32, dark: 32 });
    const frame = await create(background, 'Frame', { x: 220, y: 100, width: 360, height: 400, backgroundColor: '#FFFFFF', borderWidth: 1,
      borderColor: '#E2E8F0', cornerRadius: 16, paddingTop: 24, paddingBottom: 16, paddingLeft: 32, paddingRight: { tokenId }, gap: 12,
      shadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: '#0F172A29' } });
    const label = (y, height, text, fontSize, textColor, fontWeight) => create(frame, 'Text',
      { x: 0, y, width: 296, height, text, fontSize, textColor, ...(fontWeight ? { fontWeight } : {}) });
    await label(4, 36, 'Sign in', 26, '#0F172A', 'Bold');
    await label(40, 24, 'Welcome back to your account.', 14, '#64748B');
    await label(76, 24, 'Username', 13, '#334155', 'Semibold');
    const input = (y, placeholder, inputType) => create(frame, 'TextInput',
      { x: 0, y, width: 296, height: 44, placeholder, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', cornerRadius: 8, fontSize: 14,
        ...(inputType ? { inputType } : {}) });
    const username = await input(106, 'Username');
    await label(164, 24, 'Password', 13, '#334155', 'Semibold');
    const password = await input(194, 'Password', 'Password');
    const loginButton = await create(frame, 'Button', { x: 0, y: 268, width: 296, height: 44, text: 'Login', backgroundColor: '#2563EB', borderWidth: 0,
      cornerRadius: 8, fontSize: 15, textColor: '#FFFFFF', fontWeight: 'Semibold',
      shadow: { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: '#2563EB3D' } });
    const move = position => call('move_node', { nodeId: loginButton, expectedParentId: frame, targetParentId: frame, position });
    await move(5);
    expect((await read()).nodes.find(n => n.id === frame).childIds.indexOf(loginButton)).toBe(5);
    await move(6);
    const original = await read();
    expect(original.nodes.find(n => n.id === frame).childIds.indexOf(loginButton)).toBe(6);
    expect(original.nodes.find(n => n.id === frame).properties.paddingRight).toEqual({ type: 'token', tokenId });
    expect(original.nodes.find(n => n.id === frame).properties.shadow.color.alpha).toBe(41);
    expect(original.nodes.find(n => n.id === loginButton).properties.shadow.color.alpha).toBe(61);
    const { screenId: errorScreen } = await call('duplicate_screen', { screenId: loginScreen, expectedRevision: (await call('get_document')).revision });
    await call('rename_screen', { screenId: errorScreen, name: 'Login Error' });
    const duplicated = await read();
    const copiedBackground = duplicated.screens.find(s => s.id === errorScreen).childIds[0];
    const copiedFrame = duplicated.nodes.find(n => n.id === copiedBackground).childIds[0];
    expect(copiedFrame).not.toBe(frame);
    expect(duplicated.nodes.find(n => n.id === copiedFrame).properties).toEqual(original.nodes.find(n => n.id === frame).properties);
    await create(copiedFrame, 'Text', { x: 0, y: 320, width: 296, height: 24, text: 'Invalid password', fontSize: 13, textColor: '#B91C1C' });
    for (const [nodeId, event] of [[loginButton, 'Click'], [password, 'Submit']])
      await call('create_scenario', { screenId: loginScreen, nodeId, event, actions: [{ type: 'navigate', screenId: errorScreen }] });
    await call('save_version', { name: 'Login and invalid password' });
    const snapshot = await read();
    expect(snapshot.screens).toHaveLength(2);
    expect(snapshot.scenarios).toHaveLength(2);
    for (const editor of [page, second]) {
      await show(editor, 'layers');
      await expect(editor.locator('#screens .screen-select')).toHaveCount(2);
      await editor.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]').click();
      await expect(editor.locator('#screen-boundary')).toContainText('Sign in');
      await expect(editor.locator('#screen-boundary')).toContainText('Login');
    }

    async function preview(editor, visual) {
      await editor.getByRole('button', { name: 'Preview', exact: true }).click();
      const login = editor.locator('#preview-viewport [data-preview-screen="' + loginScreen + '"]');
      const error = editor.locator('#preview-viewport [data-preview-screen="' + errorScreen + '"]');
      await expect(login.locator('[data-visual-node="' + frame + '"]')).toHaveCSS('box-shadow', /rgba\(15, 23, 42, 0\.16/);
      if (visual) await verifyLoginVisual(editor, login, 'MCP Login Preview');
      await login.locator('[data-visual-node="' + username + '"] input').fill('demo-user');
      const secret = login.locator('[data-visual-node="' + password + '"] input');
      await expect(secret).toHaveAttribute('type', 'password');
      await secret.fill('example-only');
      await secret.press('Enter');
      await expect(error).toContainText('Invalid password');
      if (visual) await verifyLoginVisual(editor, error, 'MCP Login Error Preview');
      await editor.getByRole('button', { name: 'Назад по сценарию' }).click();
      await login.getByRole('button', { name: 'Login', exact: true }).click();
      await expect(error).toContainText('Invalid password');
      await editor.getByRole('button', { name: 'Вернуться в Design' }).click();
    }
    await preview(page, true);
    await page.close();
    await second.close();
    await server.restart();
    const old = await request.get(server.url + '/mcp', { headers: { Authorization: 'Bearer ' + token } });
    expect(old.status()).toBe(401);
    const reopened = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
    try {
      await signIn(reopened, server);
      await reopened.getByRole('link', { name: 'MCP Login Prototype' }).click();
      await expect(reopened.locator('#screens .screen-select')).toHaveCount(2);
      expect(await read()).toEqual(snapshot);
      const access = await grant(reopened);
      expect(access.token === token).toBe(false);
      const newCall = await connect(request, access.endpoint, access.token);
      expect((await newCall('get_document')).documentId).toBe(documentPath.split('/').pop());
      await reopened.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]').click();
      await preview(reopened, false);
      await reopened.locator('#mcp-access-menu summary').click();
      await reopened.getByRole('button', { name: 'Отозвать MCP-доступ' }).click();
      await expect(reopened.getByText('Доступ не предоставлен', { exact: true })).toBeVisible();
      expect((await request.get(access.endpoint, { headers: { Authorization: 'Bearer ' + access.token } })).status()).toBe(401);
    } finally { await reopened.close(); }
  } finally { if (!second.isClosed()) await second.close(); }
});


test('MCP capture UI fails closed and delivers a PNG from a simulated browser media stream', async ({ page, request, server }) => {
  test.setTimeout(120000);
  // Test-only API doubles: the native browser picker and Element Capture compositor
  // are deliberately NOT claimed as covered by this test.
  await page.addInitScript(() => {
    const mock = window.captureMock = { reject: true, stopped: 0, restricted: 0, requested: 0 };
    Object.defineProperty(window, 'RestrictionTarget', { configurable: true, value: {
      fromElement: async element => {
        if (element.id !== 'preview-viewport') throw new Error('Unexpected target');
        return element;
      }
    } });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async options => {
      if (options.audio || !options.preferCurrentTab) throw new Error('Unexpected capture options');
      mock.requested++;
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        const button = document.querySelector('#preview-viewport button');
        ctx.fillStyle = button ? getComputedStyle(button).backgroundColor : '#fff';
        ctx.fillRect(0, 0, 80, 60);
        ctx.fillStyle = frame++ % 2 ? '#000' : '#fff';
        ctx.fillRect(0, 0, 1, 1);
      };
      draw();
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: 'browser' });
      track.restrictTo = async target => {
        if (target.id !== 'preview-viewport' || mock.reject) throw new Error('Restriction failed');
        mock.restricted++;
      };
      const timer = setInterval(draw, 50);
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); mock.stopped++; stop(); };
      return stream;
    } });
  });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('Capture mock');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const access = await grant(page);
  const call = await connect(request, access.endpoint, access.token);
  const { pageId } = await call('create_page', { name: 'Login' });
  const { screenId } = await call('create_screen', { pageId, width: 400, height: 300, name: 'Login' });
  const { nodeId } = await call('create_node', { parentId: screenId, kind: 'Button', name: 'Login',
    properties: { text: 'Login', width: 160, height: 40, backgroundColor: '#2563EB' } });
  await show(page, 'layers');
  await page.locator('#screens .screen-select[data-screen-id="' + screenId + '"]').click();
  await expect(page.locator('#screen-boundary')).toContainText('Login');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#preview-viewport')).toContainText('Login');
  await page.locator('#mcp-access-menu summary').click();
  const panel = page.getByRole('region', { name: 'Screen Capture' });
  const enable = panel.getByRole('button', { name: 'Enable screen capture' });
  await enable.click();
  await expect(panel.getByRole('status')).toHaveText('Error');
  await expect.poll(() => page.evaluate(() => window.captureMock.stopped)).toBe(1);
  expect((await call.raw('render_screen', { screenId })).structuredContent.code).toBe('RENDERER_UNAVAILABLE');
  await page.evaluate(() => { window.captureMock.reject = false; });
  await enable.click();
  await expect(panel.getByRole('status')).toHaveText('Ready', { timeout: 15000 });
  const firstRevision = (await call('get_document')).revision;
  const first = await call.raw('render_screen', { screenId, revision: firstRevision });
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toEqual({ screenId, revision: firstRevision, width: 80, height: 60 });
  const firstImage = first.content.find(block => block.type === 'image');
  expect(firstImage.mimeType).toBe('image/png');
  expect(Buffer.from(firstImage.data, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const changed = await call('set_node_properties', { nodeId, properties: { backgroundColor: '#DC2626' } });
  const second = await call.raw('render_screen', { screenId, revision: changed.revision });
  expect(second.isError, JSON.stringify(second.structuredContent)).not.toBe(true);
  expect(second.structuredContent.revision).toBe(changed.revision);
  expect(second.content.find(block => block.type === 'image').data).not.toBe(firstImage.data);
  expect((await call('get_document')).revision).toBe(changed.revision);
  expect(await page.evaluate(() => window.captureMock.requested)).toBe(2);
  await panel.getByRole('button', { name: 'Stop screen capture' }).click();
  await expect(panel.getByRole('status')).toHaveText('Capture disabled');
  await expect.poll(async () => (await call.raw('render_screen', { screenId })).structuredContent.code).toBe('RENDERER_UNAVAILABLE');
  expect((await call('get_document')).revision).toBe(changed.revision);
});


test('native Chromium Element Capture isolates the actual Login Preview and tracks MCP edits', async ({ request, server }, testInfo) => {
  test.setTimeout(120000);
  // A disposable browser on the UI test runner, never an existing user browser.
  // The Chromium test-only switch auto-accepts the current test tab. Production
  // always invokes the native picker with an explicit user gesture.
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--auto-accept-this-tab-capture'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await signIn(page, server);
    await page.getByLabel('Имя нового документа').fill('Native Capture Login');
    await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
    const access = await grant(page);
    const call = await connect(request, access.endpoint, access.token);
    const { pageId } = await call('create_page', { name: 'Login' });
    const { screenId } = await call('create_screen', { pageId, width: 400, height: 300, name: 'Login' });
    await call('create_node', { parentId: screenId, kind: 'Frame', name: 'Background',
      properties: { x: 0, y: 0, width: 400, height: 300, backgroundColor: '#16A34A', borderWidth: 0, cornerRadius: 0 } });
    await call('create_node', { parentId: screenId, kind: 'Text', name: 'Title',
      properties: { x: 40, y: 25, width: 320, height: 32, text: 'Sign in', fontSize: 24, textColor: '#FFFFFF' } });
    await call('create_node', { parentId: screenId, kind: 'TextInput', name: 'Email',
      properties: { x: 40, y: 75, width: 320, height: 40, placeholder: 'Email', backgroundColor: '#FFFFFF' } });
    const { nodeId } = await call('create_node', { parentId: screenId, kind: 'Button', name: 'Login',
      properties: { x: 40, y: 160, width: 320, height: 48, text: 'Login', backgroundColor: '#2563EB', cornerRadius: 8,
        textColor: '#FFFFFF', shadow: { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: '#00000060' } } });
    await show(page, 'layers');
    await page.locator('#screens .screen-select[data-screen-id="' + screenId + '"]').click();
    await expect(page.locator('#screen-boundary')).toContainText('Login');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('#preview-viewport')).toContainText('Login');
    const bounds = await page.locator('#preview-viewport').boundingBox();
    await page.locator('#mcp-access-menu summary').click();
    const panel = page.getByRole('region', { name: 'Screen Capture' });
    await panel.getByRole('button', { name: 'Enable screen capture' }).click();
    await expect(panel.getByRole('status')).toHaveText('Ready', { timeout: 20000 });
    await page.locator('#mcp-access-menu summary').click();

    const inspect = async (result, name) => {
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
      const image = result.content.find(block => block.type === 'image');
      expect(image?.mimeType).toBe('image/png');
      const bytes = Buffer.from(image.data, 'base64');
      await testInfo.attach(name, { body: bytes, contentType: 'image/png' });
      const decoded = await page.evaluate(async data => {
        const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const pixel = (x, y) => [...ctx.getImageData(Math.floor(x * bitmap.width), Math.floor(y * bitmap.height), 1, 1).data];
        const info = { width: bitmap.width, height: bitmap.height, background: pixel(.02, .02), button: pixel(.2, .6) };
        bitmap.close(); return info;
      }, image.data);
      expect(decoded.width).toBe(result.structuredContent.width);
      expect(decoded.height).toBe(result.structuredContent.height);
      expect(decoded.width).toBeLessThanOrEqual(Math.ceil(bounds.width) + 2);
      expect(decoded.height).toBeLessThanOrEqual(Math.ceil(bounds.height) + 2);
      expect(decoded.background[1]).toBeGreaterThan(decoded.background[0] + 45);
      expect(decoded.background[1]).toBeGreaterThan(decoded.background[2] + 45);
      return decoded.button;
    };
    const firstRevision = (await call('get_document')).revision;
    const first = await call.raw('render_screen', { screenId, revision: firstRevision });
    const blue = await inspect(first, 'native-login-before');
    expect(blue[2]).toBeGreaterThan(blue[0] + 50);
    const changed = await call('set_node_properties', { nodeId, properties: { backgroundColor: '#DC2626' } });
    const second = await call.raw('render_screen', { screenId, revision: changed.revision });
    expect(second.structuredContent.revision).toBe(changed.revision);
    const red = await inspect(second, 'native-login-after');
    expect(red[0]).toBeGreaterThan(red[2] + 50);
    expect((await call('get_document')).revision).toBe(changed.revision);
    await page.locator('#mcp-access-menu summary').click();
    await panel.getByRole('button', { name: 'Stop screen capture' }).click();
    await expect.poll(async () => (await call.raw('render_screen', { screenId })).structuredContent.code).toBe('RENDERER_UNAVAILABLE');
    expect((await call('get_document')).revision).toBe(changed.revision);
  } finally { await browser.close(); }
});
