const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { verifyLoginVisual } = require('./login-visual');

async function connect(request, endpoint, token) {
  let id = 0;
  let protocolVersion;
  async function rpc(method, params, notification = false) {
    const requestId = notification ? undefined : ++id;
    const response = await request.post(endpoint, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) },
      data: { jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, params }
    });
    expect(response.ok(), 'MCP ' + method + ': HTTP ' + response.status()).toBeTruthy();
    if (notification) return;
    const body = await response.text();
    const message = body.startsWith('{') ? JSON.parse(body) :
      body.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(message => message.id === requestId);
    expect(message?.error).toBeUndefined();
    return message.result;
  }
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'FigVam UI acceptance', version: '1' } });
  protocolVersion = initialized.protocolVersion;
  await rpc('notifications/initialized', {}, true);
  const tools = (await rpc('tools/list', {})).tools;
  expect(tools).toHaveLength(34);
  const renderSchema = tools.find(t => t.name === 'render_screen').inputSchema;
  expect(renderSchema.properties.theme.anyOf[0].enum).toEqual(['Light', 'Dark']);
  expect(renderSchema.required).not.toContain('theme');
  for (const name of ['get_node', 'get_screen_tree', 'simulate_preview'])
    expect(tools.find(t => t.name === name).inputSchema.properties.theme.enum).toEqual(['Light', 'Dark']);
  expect(tools.find(t => t.name === 'simulate_preview').inputSchema.properties.events.items.properties.event.enum).toEqual(['Click', 'Change', 'Submit']);
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
    const { tokenId: primaryToken } = await call('create_token', { name: 'login.primary', type: 'Color', light: '#2563EB', dark: '#60A5FA' });
    const loginButton = await create(frame, 'Button', { x: 0, y: 268, width: 296, height: 44, text: 'Login', backgroundColor: { tokenId: primaryToken }, borderWidth: 0,
      cornerRadius: 8, fontSize: 15, textColor: '#FFFFFF', fontWeight: 'Semibold',
      shadow: { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: '#2563EB3D' } });
    const move = position => call('move_node', { nodeId: loginButton, expectedParentId: frame, targetParentId: frame, position });
    await move(5);
    expect((await read()).nodes.find(n => n.id === frame).childIds.indexOf(loginButton)).toBe(5);
    await move(6);
    // Exercise MCP value round-tripping, not the internal duplicate_screen command.
    const propertiesOf = async nodeId => (await call('get_node', { nodeId })).items[0].properties;
    const cardProperties = await propertiesOf(frame);
    const buttonProperties = await propertiesOf(loginButton);
    const cardCopy = await create(background, 'Frame', cardProperties);
    const buttonCopy = await create(cardCopy, 'Button', buttonProperties);
    expect(await propertiesOf(cardCopy)).toEqual(cardProperties);
    expect(await propertiesOf(buttonCopy)).toEqual(buttonProperties);
    expect(buttonProperties.backgroundColor).toEqual({ type: 'token', tokenId: primaryToken });
    expect(buttonProperties.shadow.color.alpha).toBe(61);
    await call('set_node_properties', { nodeId: buttonCopy, properties: { text: 'Temporary' } });
    await call('set_node_properties', { nodeId: buttonCopy, properties: buttonProperties });
    expect(await propertiesOf(buttonCopy)).toEqual(buttonProperties);
    await call('delete_node', { nodeId: cardCopy });
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


test('Autonomous MCP rendering uses both themes and screens without changing editor state', async ({ page, request, server }, testInfo) => {
  test.setTimeout(300000);
  // Even if requested accidentally, the native tab picker must never be used.
  await page.addInitScript(() => {
    window.displayMediaRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = () => {
      window.displayMediaRequests++;
      throw new Error('Unexpected native capture');
    };
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('Autonomous Login');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const access = await grant(page);
  const call = await connect(request, access.endpoint, access.token);
  const { pageId } = await call('create_page', { name: 'Login flow' });
  const { screenId: login } = await call('create_screen', { pageId, width: 800, height: 600, name: 'Login' });
  const { types } = await call('list_token_types');
  expect(types).toContain('Color');
  expect(types).toContain('Typography');
  const colorSchema = await call('get_token_schema', { type: 'Color' });
  const typographySchema = await call('get_token_schema', { type: 'Typography' });
  const dimensionSchema = await call('get_token_schema', { type: 'Dimension' });
  const { tokenId: bg } = await call('create_token', { name: 'login.background', type: colorSchema.type, light: '#EEF2F7', dark: '#15243A' });
  const { tokenId: typography } = await call('create_token', { name: 'login.typography', type: typographySchema.type,
    light: typographySchema.example, dark: typographySchema.example });
  const { tokenId: spacing } = await call('create_token', { name: 'login.spacing', type: dimensionSchema.type,
    category: dimensionSchema.category.allowedValues.find(c => c === 'Spacing'), light: 0, dark: 0 });
  const create = async (parentId, kind, properties) => (await call('create_node', { parentId, kind, properties })).nodeId;
  const { tokenId: radius } = await call('create_token', { name: 'login.radius', type: 'Dimension', category: 'Radius', light: 8, dark: 8 });
  const { tokenId: primary } = await call('create_token', { name: 'login.button', type: 'Color', light: '#2563EB', dark: '#2563EB' });
  const cardShadow = { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: '#00000020' };
  const buttonShadow = { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: '#00000060' };
  const { tokenId: cardShadowId } = await call('create_token', { name: 'login.shadow.card', type: 'Shadow', light: cardShadow, dark: { ...cardShadow, blurRadius: 12 } });
  const { tokenId: buttonShadowId } = await call('create_token', { name: 'login.shadow.button', type: 'Shadow', light: buttonShadow, dark: { ...buttonShadow, blurRadius: 12 } });
  const background = await create(login, 'Frame', { x: 0, y: 0, width: 800, height: 600,
    backgroundColor: { tokenId: bg }, borderWidth: 0, cornerRadius: 0, paddingLeft: { tokenId: spacing }, shadow: { tokenId: cardShadowId } });
  await create(login, 'Text', { x: 250, y: 80, width: 300, height: 40, text: 'Sign in', typography: { tokenId: typography } });
  const input = await create(login, 'TextInput', { x: 250, y: 140, width: 300, height: 44, placeholder: 'Email', backgroundColor: '#FFFFFF' });
  const password = await create(login, 'TextInput', { x: 250, y: 255, width: 300, height: 40, placeholder: 'Password', inputType: 'Password', backgroundColor: '#FFFFFF' });
  const button = await create(login, 'Button', { x: 250, y: 200, width: 300, height: 48, text: 'Login',
    backgroundColor: { tokenId: primary }, borderWidth: 0, cornerRadius: { tokenId: radius }, textColor: '#FFFFFF',
    shadow: { tokenId: buttonShadowId } });
  const { screenId: error } = await call('duplicate_screen', { screenId: login, expectedRevision: (await call('get_document')).revision, name: 'Login Error' });
  await call('create_scenario', { screenId: login, nodeId: button, event: 'Click', actions: [{ type: 'navigate', screenId: error }] });
  await call('create_scenario', { screenId: login, nodeId: password, event: 'Submit', actions: [{ type: 'navigate', screenId: error }] });
  await create(error, 'Text', { x: 250, y: 300, width: 300, height: 40, text: 'Invalid password',
    fontSize: 22, textColor: '#FF0000' });
  const { pageId: otherPage } = await call('create_page', { name: 'Other page' });
  const { screenId: other } = await call('create_screen', { pageId: otherPage, width: 320, height: 240, name: 'Other screen' });
  await show(page, 'layers');
  await expect(page.locator('#pages [data-page-id="' + otherPage + '"]')).toBeVisible();
  // The selected screen is not the requested screen, and is on another page.
  const otherPageButton = page.locator('#pages [data-page-id="' + otherPage + '"]');
  if (await otherPageButton.getAttribute('aria-pressed') !== 'true') await otherPageButton.click();
  await page.locator('#screens [data-screen-id="' + other + '"].screen-select').click();
  await expect(page.locator('#screens .screen-select[aria-pressed=true]')).toHaveAttribute('data-screen-id', other);
  await expect(page.locator('#editor-preview')).toBeHidden();
  await page.locator('#zoom-in').click();

  async function editorState() {
    return page.evaluate(() => ({
      page: document.querySelector('#pages .page-select[aria-pressed=true]')?.dataset.pageId,
      screen: document.querySelector('#screens .screen-select[aria-pressed=true]')?.dataset.screenId,
      theme: document.querySelector('#preview-theme button[aria-pressed=true]')?.dataset.theme,
      selection: [...document.querySelectorAll('#layers [aria-selected=true]')].map(x => x.dataset.id),
      preview: !document.getElementById('editor-preview').hidden,
      zoom: document.getElementById('zoom-level').textContent,
      transform: document.getElementById('screen-boundary').style.transform,
      revision: document.getElementById('revision').textContent,
      undo: document.getElementById('undo').disabled,
      redo: document.getElementById('redo').disabled,
      history: document.getElementById('versions-list').textContent
    }));
  }
  const revision = (await call('get_document')).revision;
  // Wait for the editor to receive the committed revision before comparing UI state.
  await expect(page.locator('#revision')).toContainText(String(revision));
  const before = await editorState();
  const readSnapshot = async () => (await (await request.get(server.url + '/api/v1' + new URL(page.url()).pathname + '/document.json', { headers: { Authorization: 'Bearer ' + bearer } })).json()).document;
  const documentBefore = await readSnapshot();
  const transitionImages = [];
  for (const screenId of [login, error]) {
    for (const theme of ['Light', 'Dark']) {
      const tree = await call('get_screen_tree', { screenId, depth: 10, includeProperties: true, includeResolvedProperties: true, theme });
      const shared = tree.items.find(n => n.kind === 'Button');
      expect(shared.properties.backgroundColor.tokenId).toBe(primary);
      expect(shared.properties.cornerRadius.tokenId).toBe(radius);
      expect(shared.properties.shadow.tokenId).toBe(buttonShadowId);
      expect(shared.resolvedProperties.shadow.blurRadius).toBe(theme === 'Light' ? 8 : 12);
      const card = tree.items.find(n => n.id === background || n.kind === 'Frame');
      expect(card.properties.shadow.tokenId).toBe(cardShadowId);
      expect(card.resolvedProperties.shadow.blurRadius).toBe(theme === 'Light' ? 8 : 12);
    }
  }
  for (const theme of ['Light', 'Dark']) {
    for (const event of ['Click', 'Submit']) {
      const simulated = await call.raw('simulate_preview', { screenId: login, theme, includeImage: true, events: [
        { nodeId: input, event: 'Change', value: 'demo@example.test' },
        { nodeId: password, event: 'Change', value: 'not-a-real-password' },
        { nodeId: event === 'Click' ? button : password, event }
      ] });
      expect(simulated.isError, JSON.stringify(simulated.structuredContent)).not.toBe(true);
      expect(simulated.structuredContent.activeScreenId).toBe(error);
      expect(simulated.structuredContent.theme).toBe(theme);
      expect(simulated.structuredContent.demoValues[input]).toBe('demo@example.test');
      expect(simulated.structuredContent.demoValues[password]).toBeUndefined();
      expect(JSON.stringify(simulated.structuredContent)).not.toContain('not-a-real-password');
      const image = simulated.content.find(block => block.type === 'image');
      expect(image?.mimeType).toBe('image/png');
      transitionImages.push({ theme, image });
      await testInfo.attach('simulation-' + theme + '-' + event, { body: Buffer.from(image.data, 'base64'), contentType: 'image/png' });
      const independent = await call('simulate_preview', { screenId: login, theme, events: [] });
      expect(independent.activeScreenId).toBe(login);
      expect(independent.demoValues).toEqual({});
    }
  }
  expect(await readSnapshot()).toEqual(documentBefore);
  expect(await editorState()).toEqual(before);
  async function inspect(screenId, theme, name, expectedRevision, expectedBackground, expectedError, expectedButton = [37, 99, 235]) {
    const result = await call.raw('render_screen', { screenId, ...(theme ? { theme } : {}) });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
    const image = result.content.find(block => block.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect(result.structuredContent).toEqual({ screenId, theme: theme ?? 'Dark', revision: expectedRevision, width: 800, height: 600 });
    await testInfo.attach(name, { body: Buffer.from(image.data, 'base64'), contentType: 'image/png' });
    await assertImage(image, expectedBackground, expectedError, expectedButton);
  }
  async function assertImage(image, expectedBackground, expectedError, expectedButton = [37, 99, 235]) {
    const pixels = await page.evaluate(async data => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      const region = ctx.getImageData(250, 300, 300, 40).data;
      let red = 0;
      for (let i = 0; i < region.length; i += 4)
        if (region[i] > 160 && region[i + 1] < 70 && region[i + 2] < 70) red++;
      const info = { width: bitmap.width, height: bitmap.height, bg: pixel(10, 10), button: pixel(270, 220), red };
      bitmap.close(); return info;
    }, image.data);
    expect([pixels.width, pixels.height]).toEqual([800, 600]);
    expect(pixels.bg).toEqual(expectedBackground);
    expect(pixels.button).toEqual(expectedButton);
    if (expectedError) expect(pixels.red).toBeGreaterThan(10);
    else expect(pixels.red).toBe(0);
  }
  for (const { theme, image } of transitionImages)
    await assertImage(image, theme === 'Light' ? [238, 242, 247] : [21, 36, 58], true);
  for (const screenId of [login, error])
    for (const theme of ['Light', 'Dark'])
      await inspect(screenId, theme, (screenId === login ? 'login' : 'login-error') + '-' + theme,
        revision, theme === 'Light' ? [238, 242, 247] : [21, 36, 58], screenId === error);
  await inspect(login, 'Light', 'light-repeat', revision, [238, 242, 247], false);
  await Promise.all([
    inspect(login, 'Light', 'parallel-light', revision, [238, 242, 247], false),
    inspect(login, 'Dark', 'parallel-dark', revision, [21, 36, 58], false)
  ]);
  expect(await readSnapshot()).toEqual(documentBefore);
  expect(await editorState()).toEqual(before);
  expect((await call('get_document')).revision).toBe(revision);
  expect((await call.raw('render_screen', { screenId: login, theme: 'Sepia' })).structuredContent.code).toBe('INVALID_THEME');
  expect((await call.raw('render_screen', { screenId: '00000000-0000-0000-0000-000000000001' })).structuredContent.code).toBe('SCREEN_NOT_FOUND');

  // Changes are rendered from the server revision, not a stale editor DOM.
  const changedToken = await call('set_token_value', { tokenId: bg, theme: 'Dark', value: '#102030' });
  await inspect(login, 'Dark', 'changed-token', changedToken.revision, [16, 32, 48], false);
  const changedShadow = await call('set_token_value', { tokenId: buttonShadowId, theme: 'Dark', value: { ...buttonShadow, blurRadius: 20 } });
  for (const screenId of [login, error]) {
    const tree = await call('get_screen_tree', { screenId, includeResolvedProperties: true, theme: 'Dark' });
    expect(tree.items.find(n => n.kind === 'Button').resolvedProperties.shadow.blurRadius).toBe(20);
  }
  await call('set_token_value', { tokenId: buttonShadowId, theme: 'Dark', value: { ...buttonShadow, blurRadius: 12 } });
  const changedButton = await call('set_token_value', { tokenId: primary, theme: 'Dark', value: '#DC2626' });
  await inspect(login, 'Dark', 'changed-button', changedButton.revision, [16, 32, 48], false, [220, 38, 38]);

  // Preview has no MCP controls and doesn't change the direct grant.
  const loginPageButton = page.locator('#pages [data-page-id="' + pageId + '"]');
  await loginPageButton.click();
  await page.locator('#screens .screen-select[data-screen-id="' + login + '"]').click();
  await expect(page.locator('#screen-boundary')).toContainText('Sign in');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#preview-viewport')).toContainText('Sign in');
  await expect(page.locator('#editor-preview #mcp-access-menu')).toHaveCount(0);
  await page.locator('#preview-theme button[data-theme=Dark]').click();
  await expect(page.locator('#preview-theme button[data-theme=Dark]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#preview-viewport [data-visual-node="' + background + '"] > .visual-surface')).toHaveCSS('background-color', 'rgb(16, 32, 48)');
  const previewBefore = await editorState();
  await inspect(login, 'Light', 'explicit-light-in-dark-preview', changedButton.revision, [238, 242, 247], false);
  await inspect(login, null, 'current-dark', changedButton.revision, [16, 32, 48], false, [220, 38, 38]);
  expect(await editorState()).toEqual(previewBefore);
  await page.locator('#preview-theme button[data-theme=Light]').click();
  await inspect(error, 'Dark', 'explicit-dark-in-light-preview', changedButton.revision, [16, 32, 48], true, [220, 38, 38]);
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await call('set_token_value', { tokenId: primary, theme: 'Dark', value: '#2563EB' });
  await call('set_token_value', { tokenId: bg, theme: 'Dark', value: '#15243A' });
  await call('save_version', { name: 'P2 Login Prototype' });
  // The document grant remains valid even when there is no editor capture provider.
  expect(await page.evaluate(() => window.displayMediaRequests)).toBe(0);
  await page.locator('#mcp-access-menu summary').click();
  await expect(page.getByRole('region', { name: 'Screen Capture' })).toHaveCount(0);
  const documentUrl = page.url();
  const documentPath = new URL(documentUrl).pathname;
  await page.close();
  const detached = await call.raw('simulate_preview', { screenId: login, theme: 'Light', includeImage: true,
    events: [{ nodeId: button, event: 'Click' }] });
  expect(detached.isError, JSON.stringify(detached.structuredContent)).not.toBe(true);
  expect(detached.structuredContent.activeScreenId).toBe(error);
  expect(detached.content.some(block => block.type === 'image')).toBe(true);
  const revoked = await request.delete(server.url + '/api/v1' + documentPath + '/mcp-access', { headers: { Authorization: 'Bearer ' + bearer } });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();
  const denied = await request.post(access.endpoint, { headers: { Authorization: 'Bearer ' + access.token, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'render_screen', arguments: { screenId: login } } } });
  expect(denied.status()).toBe(401);
});
