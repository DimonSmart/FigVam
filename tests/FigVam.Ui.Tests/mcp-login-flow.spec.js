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
  expect(tools).toHaveLength(42);
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

// Live updates are revision-pinned and can queue while a series of MCP/REST
// edits is in flight. Wait for the committed revision, not for a fixed delay
// or merely for a screen from an earlier revision to appear.
async function waitForRevision(page, revision) {
  await expect(page.locator('#revision')).toHaveText('Общий черновик · ревизия ' + revision, { timeout: 45000 });
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
  await page.locator('#mcp-access-menu').getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(secret).toHaveAttribute('type', 'text');
  await page.locator('#mcp-access-menu').getByRole('button', { name: 'Скрыть', exact: true }).click();
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
    const finalRevision = (await call('get_document')).revision;
    const snapshot = await read();
    expect(snapshot.screens).toHaveLength(2);
    expect(snapshot.scenarios).toHaveLength(2);
    await Promise.all([page, second].map(editor => waitForRevision(editor, finalRevision)));
    for (const editor of [page, second]) {
      await show(editor, 'layers');
      await expect(editor.locator('#screens .screen-select')).toHaveCount(2);
      await editor.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]').click();
      await expect(editor.locator('#screen-boundary')).toContainText('Sign in');
      await expect(editor.locator('#screen-boundary')).toContainText('Login');
    }

    async function preview(editor, visual) {
      await waitForRevision(editor, finalRevision);
      await editor.getByRole('button', { name: 'Preview', exact: true }).click();
      const login = editor.locator('#preview-viewport [data-preview-screen="' + loginScreen + '"]');
      const error = editor.locator('#preview-viewport [data-preview-screen="' + errorScreen + '"]');
      await expect(login).toHaveAttribute('data-revision', String(finalRevision));
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


// Compare native Chromium screenshots, not PNG signatures or selected colors alone.
// Ignore only minor antialiasing differences (<= 16 levels); a large changed
// region or a substantial average channel error still fails the comparison.
async function compareNativePreview(page, image) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    document.activeElement?.blur();
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('#preview-viewport img')].map(img => img.decode()));
  });
  const expected = Buffer.from(image.data, 'base64');
  const width = expected.readUInt32BE(16), height = expected.readUInt32BE(20);
  const viewport = page.locator('#preview-viewport');
  // Compare the actual Preview DOM at the same integer origin as the server.
  // Do not use CSS transforms: they change Chromium's text rasterization.
  const bounds = await viewport.boundingBox();
  expect(Math.abs(bounds.width - width), JSON.stringify({ bounds, width, height })).toBeLessThan(1);
  expect(Math.abs(bounds.height - height), JSON.stringify({ bounds, width, height })).toBeLessThan(1);
  const original = await viewport.getAttribute('style');
  let interactive;
  try {
    await viewport.evaluate((el, size) => {
      Object.assign(el.style, { position: 'fixed', left: '0px', top: '0px',
        margin: '0', width: size.width + 'px', height: size.height + 'px', zIndex: '1000' });
    }, { width, height });
    await page.mouse.move(width + 5, height + 5);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    interactive = await page.screenshot({
      clip: { x: 0, y: 0, width, height },
      animations: 'disabled', caret: 'hide', scale: 'css'
    });
  } finally {
    await viewport.evaluate((el, style) => style === null ? el.removeAttribute('style') : el.setAttribute('style', style), original);
  }
  const difference = await page.evaluate(async ({ a, b }) => {
    async function pixels(data) {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {type:'image/png'}));
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width; canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const result = { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      bmp.close();
      return result;
    }
    const [one, two] = await Promise.all([pixels(a), pixels(b)]);
    if (one.width !== two.width || one.height !== two.height) return { sizeMatches: false, interactive: [one.width, one.height], server: [two.width, two.height] };
    let changed = 0, sum = 0, minX = one.width, minY = one.height, maxX = -1, maxY = -1;
    for (let i = 0; i < one.data.length; i += 4) {
      let max = 0;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(one.data[i + channel] - two.data[i + channel]);
        max = Math.max(max, delta); sum += delta;
      }
      if (max > 16) { changed++; const x = (i / 4) % one.width, y = Math.floor(i / 4 / one.width); minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y); }
    }
    return { sizeMatches: true, changed: changed / (one.width * one.height), average: sum / one.data.length, region: [minX, minY, maxX, maxY] };
  }, { a: interactive.toString('base64'), b: image.data });
  expect(difference.sizeMatches, JSON.stringify(difference)).toBe(true);
  if (!difference.sizeMatches || difference.changed > 0.005 || difference.average > 0.5) {
    await test.info().attach('interactive-preview', { body: interactive, contentType: 'image/png' });
    await test.info().attach('server-preview', { body: expected, contentType: 'image/png' });
  }
  expect(difference.changed, JSON.stringify(difference)).toBeLessThanOrEqual(0.005);
  expect(difference.average).toBeLessThanOrEqual(0.5);
}

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
  const { types } = await call('list_token_types');
  expect(types).toContain('Typography');
  const colorSchema = await call('get_token_schema', { type: 'Color', compact: true });
  const typographySchema = await call('get_token_schema', { type: 'Typography', compact: true });
  const dimensionSchema = await call('get_token_schema', { type: 'Dimension', compact: true });
  expect(colorSchema.compact && typographySchema.compact && dimensionSchema.compact).toBe(true);
  const ref = (id, field) => ({ $ref: id + '.' + field });
  const op = (id, command, args) => ({ id, command, arguments: args });
  const { operations } = require('../../docs/examples/login-prototype-batch.json');
  const buttonShadow = operations.find(item => item.id === 'buttonShadow').arguments.light;
  expect(operations.find(item => item.id === 'typography').arguments.light).toEqual(typographySchema.example);
  const beforeBatch = (await call('get_document')).revision;
  const batchArgs = { commandId: require('node:crypto').randomUUID(), expectedRevision: beforeBatch, operations };
  const batch = await call('execute_batch', batchArgs);
  expect(batch.revision).toBe(beforeBatch + 1);
  expect(await call('execute_batch', batchArgs)).toEqual(batch);
  const results = Object.fromEntries(batch.results.map(item => [item.id, item]));
  const { pageId } = results.page;
  const login = results.login.screenId, error = results.error.screenId;
  const bg = results.background.tokenId, radius = results.radius.tokenId, primary = results.button.tokenId;
  const cardShadowId = results.cardShadow.tokenId, buttonShadowId = results.buttonShadow.tokenId;
  const shadowColorId = results.shadowColor.tokenId;
  const background = results.surface.nodeId, input = results.input.nodeId, password = results.password.nodeId, button = results.submit.nodeId;
  const failedBatch = await call.raw('execute_batch', { expectedRevision: batch.revision, operations: [
    op('temporary','create_page',{name:'Must roll back'}),
    op('invalid','create_node',{parentId:ref('future','screenId'),kind:'Text'})] });
  expect(failedBatch.isError).toBe(true);
  expect(failedBatch.structuredContent.rolledBack).toBe(true);
  expect((await call('get_document')).revision).toBe(batch.revision);
  for (const theme of ['Light','Dark']) {
    const layout = await call('get_screen_layout', {screenId:login,theme});
    expect(layout.theme).toBe(theme);
    expect(layout.boxes.find(box => box.objectId === input).bounds.height).toBe(theme === 'Light' ? 44 : 48);
    const node = (await call('get_node',{nodeId:input,includeResolvedProperties:true,theme})).items[0];
    expect(node.resolvedProperties.paddingLeft.value).toBe(theme==='Light'?12:16);
    expect(node.resolvedProperties.height.value).toBe(theme==='Light'?44:48);
  }
  const renamed = await call('rename_token',{tokenId:shadowColorId,name:'login.shadow.color',expectedRevision:batch.revision});
  expect(renamed.tokenId).toBe(shadowColorId);
  const usages = await call('get_token_usages',{tokenId:shadowColorId});
  expect(usages.items.some(item=>item.ownerId===buttonShadowId)).toBe(true);
  const refused = await call.raw('delete_token',{tokenId:shadowColorId,expectedRevision:renamed.revision});
  expect(refused.structuredContent.code).toBe('TOKEN_IN_USE');
  const unused = await call('create_token',{name:'login.unused',type:'Color',light:'#000000',dark:'#FFFFFF'});
  await call('delete_token',{tokenId:unused.tokenId,expectedRevision:unused.revision});
  const create = async (parentId, kind, properties) => (await call('create_node', { parentId, kind, properties })).nodeId;
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
    const filled = await call.raw('simulate_preview', { screenId: login, theme, includeImage: true, events: [
      { nodeId: input, event: 'Change', value: 'demo@example.test' },
      { nodeId: password, event: 'Change', value: 'not-a-real-password' }
    ] });
    expect(filled.isError, JSON.stringify(filled.structuredContent)).not.toBe(true);
    expect(filled.structuredContent.activeScreenId).toBe(login);
    expect(filled.structuredContent.simulationStatus).toBe('Completed');
    expect(filled.structuredContent.render.status).toBe('Completed');
    expect(filled.structuredContent.demoValues[password]).toBeUndefined();
    expect(JSON.stringify(filled.structuredContent)).not.toContain('not-a-real-password');
    const filledImage = filled.content.find(block => block.type === 'image');
    expect(filledImage?.mimeType).toBe('image/png');
    await testInfo.attach('filled-' + theme, { body: Buffer.from(filledImage.data, 'base64'), contentType: 'image/png' });
    const empty = await call.raw('simulate_preview', { screenId: login, theme, includeImage: true, events: [] });
    expect(empty.isError).not.toBe(true);
    const emptyImage = empty.content.find(block => block.type === 'image');
    expect(emptyImage?.mimeType).toBe('image/png');
    expect(filledImage.data).not.toBe(emptyImage.data);
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
    expect(result.structuredContent).toEqual({ screenId, theme: theme ?? 'Light', revision: expectedRevision, width: 800, height: 600 });
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
  const changedShadow = await call('set_token_value', { tokenId: buttonShadowId, theme: 'Dark', value: { ...buttonShadow, blurRadius: 20, color: { tokenId: shadowColorId } } });
  for (const screenId of [login, error]) {
    const tree = await call('get_screen_tree', { screenId, includeResolvedProperties: true, theme: 'Dark' });
    expect(tree.items.find(n => n.kind === 'Button').resolvedProperties.shadow.blurRadius).toBe(20);
  }
  await call('set_token_value', { tokenId: buttonShadowId, theme: 'Dark', value: { ...buttonShadow, blurRadius: 12, color: { tokenId: shadowColorId } } });
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
  const field = page.locator('#preview-viewport [data-visual-node="' + input + '"] > .visual-surface');
  const fieldBounds = await field.boundingBox();
  await field.focus();
  await expect(field).toHaveCSS('outline-width', '3px');
  await expect(field).toHaveCSS('outline-color', 'rgb(96, 165, 250)');
  expect(await field.boundingBox()).toEqual(fieldBounds);
  await testInfo.attach('focused-dark', { body: await page.locator('#preview-viewport').screenshot(), contentType: 'image/png' });
  await field.blur();
  const darkPng = await call.raw('render_screen', { screenId: login, theme: 'Dark' });
  await compareNativePreview(page, darkPng.content.find(block => block.type === 'image'));
  const previewBefore = await editorState();
  await inspect(login, 'Light', 'explicit-light-in-dark-preview', changedButton.revision, [238, 242, 247], false);
  await inspect(login, null, 'default-light', changedButton.revision, [238, 242, 247], false);
  expect(await editorState()).toEqual(previewBefore);
  await page.locator('#preview-theme button[data-theme=Light]').click();
  await field.focus();
  await expect(field).toHaveCSS('outline-width', '2px');
  await expect(field).toHaveCSS('outline-color', 'rgb(37, 99, 235)');
  await testInfo.attach('focused-light', { body: await page.locator('#preview-viewport').screenshot(), contentType: 'image/png' });
  await field.blur();
  const lightPng = await call.raw('render_screen', { screenId: login, theme: 'Light' });
  await compareNativePreview(page, lightPng.content.find(block => block.type === 'image'));
  await inspect(error, 'Dark', 'explicit-dark-in-light-preview', changedButton.revision, [16, 32, 48], true, [220, 38, 38]);
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await call('set_token_value', { tokenId: primary, theme: 'Dark', value: '#2563EB' });
  await call('set_token_value', { tokenId: bg, theme: 'Dark', value: '#15243A' });
  await call('save_version', { name: 'P2 Login Prototype' });
  // Both screenshot tools work without any editor tab.
  expect(await page.evaluate(() => window.displayMediaRequests)).toBe(0);
  await page.locator('#mcp-access-menu summary').click();
  await expect(page.getByRole('region', { name: 'Screen Capture' })).toHaveCount(0);
  const documentUrl = page.url();
  const documentPath = new URL(documentUrl).pathname;
  await page.close();
  const standalone = await call.raw('render_screen', { screenId: login, theme: 'Dark' });
  expect(standalone.isError, JSON.stringify(standalone.structuredContent)).not.toBe(true);
  expect(standalone.content.some(block => block.type === 'image')).toBe(true);
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


test('MCP-uploaded resource renders in an already open editor, Preview and screen capture', async ({ page, request, server }) => {
  await page.setViewportSize({ width: 1700, height: 1100 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('MCP Resource Prototype');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const { token, endpoint } = await grant(page);
  const call = await connect(request, endpoint, token);
  const { pageId } = await call('create_page');
  const { screenId } = await call('create_screen', { pageId, width: 200, height: 100 });
  await page.locator('#screens .screen-select[data-screen-id="' + screenId + '"]').click();
  const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC';
  const { assetId } = await call('upload_asset', { contentType: 'image/png', contentBase64 });
  const { nodeId } = await call('create_node', { parentId: screenId, kind: 'Image',
    properties: { asset: { assetId }, x: 0, y: 0, width: 200, height: 100, fit: 'Contain', altText: 'MCP image' } });
  const design = page.locator('#screen-boundary [data-visual-node="' + nodeId + '"] img');
  await expect(design).toBeVisible();
  await expect.poll(() => design.evaluate(img => img.naturalWidth)).toBe(2);
  const capture = await call.raw('render_screen', { screenId });
  expect(capture.isError).not.toBe(true);
  const image = capture.content.find(item => item.type === 'image');
  expect(image?.mimeType).toBe('image/png');
  const pixels = await page.evaluate(async data => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const left = [...ctx.getImageData(10, 50, 1, 1).data];
    const right = [...ctx.getImageData(190, 50, 1, 1).data];
    bitmap.close();
    return { width: canvas.width, height: canvas.height, left, right };
  }, image.data);
  expect(pixels.width).toBe(200);
  expect(pixels.height).toBe(100);
  expect(pixels.left[0]).toBeGreaterThan(200);
  expect(pixels.left[1]).toBeLessThan(55);
  expect(pixels.right[1]).toBeGreaterThan(200);
  expect(pixels.right[0]).toBeLessThan(55);
  // Compare an image under a translucent, clipping frame and wrapped text.
  // The child extends beyond the frame and its text needs several lines.
  const { nodeId: frame } = await call('create_node', { parentId: screenId, kind: 'Frame',
    properties: { x: 50, y: 10, width: 100, height: 80, overflow: 'Clip', backgroundColor: '#FFFFFF80',
      borderWidth: 1, borderColor: '#202020', opacity: 0.8 } });
  const { nodeId: wrapped } = await call('create_node', { parentId: frame, kind: 'Text',
    properties: { x: 5, y: 5, width: 120, height: 110, text: 'Long text wraps onto several lines and extends beyond the frame.',
      fontSize: 14, wrap: true, textColor: '#000000' } });
  const layered = await call.raw('render_screen', { screenId });
  expect(layered.isError, JSON.stringify(layered.structuredContent)).not.toBe(true);
  const layeredImage = layered.content.find(block => block.type === 'image');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.locator('#preview-viewport [data-visual-node="' + nodeId + '"] img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(img => img.naturalWidth)).toBe(2);
  const text = page.locator('#preview-viewport [data-visual-node="' + wrapped + '"] .visual-surface');
  await expect(text).toContainText('Long text wraps');
  expect(await text.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map(rect => rect.top)).size;
  })).toBeGreaterThan(1);
  await compareNativePreview(page, layeredImage);
});


test('TextInput placeholders and values use the correct text, mask and theme color in Design, Preview and MCP capture', async ({ page, request, server }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('TextInput regression');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const { token, endpoint } = await grant(page);
  const call = await connect(request, endpoint, token);
  const { pageId } = await call('create_page');
  const { screenId } = await call('create_screen', { pageId, width: 280, height: 370 });
  const { tokenId: placeholderToken } = await call('create_token', {
    name: 'input.placeholder', type: 'Color', light: '#CC2200', dark: '#007700'
  });
  const { tokenId: textToken } = await call('create_token', {
    name: 'input.text', type: 'Color', light: '#0044CC', dark: '#AA00AA'
  });
  const cases = [
    { inputType: 'Text', value: '', placeholder: 'Enter username' },
    { inputType: 'Text', value: 'admin', placeholder: 'Enter username' },
    { inputType: 'Password', value: '', placeholder: 'Enter password' },
    { inputType: 'Password', value: 'secret', placeholder: 'Enter password' },
    { inputType: 'Password', value: '', placeholder: '' },
    // Independent native text controls provide glyph references for the PNG.
    { inputType: 'Text', value: '', placeholder: 'Enter password' },
    { inputType: 'Text', value: '••••••', placeholder: '' }
  ];
  const ids = [];
  for (const [index, properties] of cases.entries()) {
    const { nodeId } = await call('create_node', { parentId: screenId, kind: 'TextInput',
      properties: { x: 10, y: 10 + index * 50, width: 260, height: 40,
        backgroundColor: '#FFFFFF', borderWidth: 0, cornerRadius: 0, fontSize: 20, fontFamily: 'Arial',
        textColor: { tokenId: textToken }, placeholderColor: { tokenId: placeholderToken }, ...properties } });
    ids.push(nodeId);
  }
  await page.locator('#screens .screen-select[data-screen-id="' + screenId + '"]').click();

  const colors = {
    Light: { placeholder: [204, 34, 0], value: [0, 68, 204] },
    Dark: { placeholder: [0, 119, 0], value: [170, 0, 170] }
  };
  const rgb = color => 'rgb(' + color.join(', ') + ')';
  const field = (root, id) => page.locator(root + ' [data-visual-node="' + id + '"] > input');
  async function assertFields(root, theme) {
    for (const [index, expected] of cases.entries()) {
      const input = field(root, ids[index]);
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute('type', expected.inputType.toLowerCase());
      await expect(input).toHaveAttribute('placeholder', expected.placeholder);
      await expect(input).toHaveValue(expected.value);
      await expect(input).toHaveCSS('color', rgb(colors[theme].value));
      await expect.poll(() => input.evaluate(el => getComputedStyle(el, '::placeholder').color))
        .toBe(rgb(colors[theme].placeholder));
      await expect.poll(() => input.evaluate(el => el.matches(':placeholder-shown')))
        .toBe(!expected.value); // Chromium matches even an explicitly empty placeholder.
    }
  }
  await assertFields('#screen-boundary', 'Light');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  for (const theme of ['Light', 'Dark']) {
    await page.locator('#preview-theme button[data-theme=' + theme + ']').click();
    await assertFields('#preview-viewport', theme);
    const password = field('#preview-viewport', ids[2]);
    await password.fill('secret');
    await expect(password).toHaveValue('secret');
    await expect.poll(() => password.evaluate(el => el.matches(':placeholder-shown'))).toBe(false);
    await password.fill('');
    await expect.poll(() => password.evaluate(el => el.matches(':placeholder-shown'))).toBe(true);

    const capture = await call.raw('render_screen', { screenId, theme });
    expect(capture.isError, JSON.stringify(capture.structuredContent)).not.toBe(true);
    const image = capture.content.find(block => block.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    await compareNativePreview(page, image);
    const pixels = await page.evaluate(async ({ data, colors }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const rows = Array.from({ length: 7 }, (_, i) => ctx.getImageData(14, 14 + i * 50, 248, 32).data);
      const count = (row, color) => {
        let n = 0;
        for (let i = 0; i < row.length; i += 4)
          if (Math.abs(row[i] - color[0]) + Math.abs(row[i + 1] - color[1]) + Math.abs(row[i + 2] - color[2]) < 45) n++;
        return n;
      };
      const same = (a, b) => a.every((channel, i) => channel === b[i]);
      bitmap.close();
      return {
        width: canvas.width, height: canvas.height,
        counts: rows.map(row => ({ placeholder: count(row, colors.placeholder), value: count(row, colors.value) })),
        empty: rows[4].every(channel => channel === 255),
        placeholderMatchesText: same(rows[2], rows[5]),
        passwordHasInk: count(rows[3], colors.value) > 10
      };
    }, { data: image.data, colors: colors[theme] });
    expect([pixels.width, pixels.height]).toEqual([280, 370]);
    for (const index of [0, 2]) {
      expect(pixels.counts[index].placeholder).toBeGreaterThan(10);
      expect(pixels.counts[index].value).toBe(0);
    }
    for (const index of [1, 3]) {
      expect(pixels.counts[index].value).toBeGreaterThan(10);
      expect(pixels.counts[index].placeholder).toBe(0);
    }
    expect(pixels.empty).toBe(true);
    expect(pixels.placeholderMatchesText).toBe(true);
    expect(pixels.passwordHasInk).toBe(true);
  }
});

test('Server simulation matches variants, dataset bindings, overlays and multiline input', async ({ page, request, server }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('Overlay screenshot parity');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const { token, endpoint } = await grant(page);
  const call = await connect(request, endpoint, token);
  const { pageId } = await call('create_page');
  const { screenId: base } = await call('create_screen', { pageId, width: 400, height: 300 });
  const { screenId: overlay } = await call('create_screen', { pageId, width: 400, height: 300 });
  const { nodeId: button } = await call('create_node', { parentId: base, kind: 'Button',
    properties: { x: 20, y: 20, width: 130, height: 40, text: 'Open overlay' } });
  const { nodeId: input } = await call('create_node', { parentId: overlay, kind: 'TextInput',
    properties: { x: 100, y: 100, width: 200, height: 80, multiline: true, placeholder: 'Overlay value', backgroundColor: '#FFFFFF' } });
  const { nodeId: label } = await call('create_node', { parentId: base, kind: 'Text',
    properties: { x: 20, y: 65, width: 150, height: 30, text: 'Base label' } });
  const { nodeId: bound } = await call('create_node', { parentId: overlay, kind: 'Text',
    properties: { x: 100, y: 190, width: 200, height: 40, text: 'Unbound text' } });
  const uuid = require('node:crypto').randomUUID;
  const variantId = uuid(), datasetId = uuid();
  const commands = '/api/v1' + new URL(page.url()).pathname + '/commands/';
  async function command(name, data) {
    const response = await request.post(commands + name, { headers: { Authorization: 'Bearer ' + bearer }, data: { commandId: uuid(), ...data } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await command('add-screen-variant', { screenId: base, variantId, name: 'Alternate' });
  await command('set-screen-variant-override', { screenId: base, variantId, nodeId: label, property: 'text', value: { type: 'string', value: 'Alternate label' } });
  await command('add-dataset', { datasetId, name: 'Fixture', fixtureJson: '{"name":"Dataset text"}' });
  await command('bind-node-data', { nodeId: bound, property: 'text', binding: {
    datasetId, binding: { path: [{ type: 'property', name: 'name' }], operation: 0, expectedType: 1 }
  } });
  // MCP create_scenario currently accepts only navigate; use the existing document command.
  const scenario = await request.post('/api/v1' + new URL(page.url()).pathname + '/commands/create-scenario', {
    headers: { Authorization: 'Bearer ' + bearer },
    data: { commandId: require('node:crypto').randomUUID(), scenario: {
      id: require('node:crypto').randomUUID(), screenId: base, nodeId: button, event: 0,
      actions: [{ type: 'showVariant', variantId }, { type: 'selectDataset', datasetId }, { type: 'openOverlay', screenId: overlay }, { type: 'setDemoValue', nodeId: input, value: 'Final state\nSecond line' }]
    } }
  });
  expect(scenario.ok(), await scenario.text()).toBeTruthy();
  const finalRevision = (await call('get_document')).revision;
  await waitForRevision(page, finalRevision);
  await page.locator('#screens .screen-select[data-screen-id="' + base + '"]').click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const basePreview = page.locator('#preview-viewport [data-preview-screen="' + base + '"]');
  await expect(basePreview).toHaveAttribute('data-revision', String(finalRevision));
  await basePreview.locator('[data-visual-node="' + button + '"] button').click();
  await expect(page.locator('#preview-viewport .preview-screen')).toHaveCount(2);
  const field = page.locator('#preview-viewport [data-visual-node="' + input + '"] textarea');
  await expect(field).toHaveValue('Final state\nSecond line');
  await expect(page.locator('#preview-viewport [data-visual-node="' + label + '"]')).toContainText('Alternate label');
  await expect(page.locator('#preview-viewport [data-visual-node="' + bound + '"]')).toContainText('Dataset text');
  const result = await call.raw('simulate_preview', { screenId: base, theme: 'Light', includeImage: true,
    events: [{ nodeId: button, event: 'Click' }] });
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  expect(result.structuredContent.overlays).toEqual([overlay]);
  await compareNativePreview(page, result.content.find(block => block.type === 'image'));
});

test('Uploaded variable font is loaded for native Preview and detached screenshots', async ({ page, request, server }) => {
  test.setTimeout(120000);
  const uuid = require('node:crypto').randomUUID;
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, server);
  await page.getByLabel('Имя нового документа').fill('Variable font parity');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const access = await grant(page);
  const call = await connect(request, access.endpoint, access.token);
  const { pageId } = await call('create_page');
  const { screenId } = await call('create_screen', { pageId, width: 320, height: 180 });
  const familyId = uuid(), familyName = 'FigVamProbe';
  await call('upload_asset', { contentType: 'font/woff2',
    contentBase64: 'd09GMgABAAAAAAHIAA4AAAAABGgAAAFuAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP0hWQVIqBmA/U1RBVBwANC8kChg2MC4BNgIkAwYLBgAEIAWCfQcmG4QDIC4ObDrPQjtGVGhWnI3Qu774EM9TS/f+7iaUWoyFU/EIW4XE1vF04ZGa8Zxx8Xmu+a/E755HYYVVYPSqgIcbjWwNA2BUv2LS8h9Yzc/d820nHj2ggFJtJW0HlElL4zyBAsnDM8sw/STw3cZmHsFRiEN+31DAKgAgmBUsIlBArb0bjAYmoIsrgo5T83FQr/wAAIcgYlKwCqA83G9PAqCgYhUlWEU7BE0TdGO0LLBbRIpVMBn3OzCBG6ivEKCAhqBhAGiAtMxMTPs5/AGCgG0k2AZMP8a0yUeX8Njlm7fXNwTh9/My2y7on6y1h3+jARV+6mFQFRAKk740NzapPUgpYqQQk9kADTGDgGLCzIpqwTKaFRwNWVOEoRFK2pRYF60o5l2j2ndDc+5DQ/6fw6y/Xev+lN4vw/wtqzyOPNBiTfEaXmA9CUI7q1rvJHV3MZjlZquXo96dc3gyiWToZ8XUjLkxz4LNE0nekk4BAAAA',
    font: { familyId, familyName, faceId: uuid(), faceName: 'Variable', weightFrom: 100, weightTo: 900, style: 0 } });
  const ids = [];
  for (const [index, weight] of [100, 900].entries()) {
    const { nodeId } = await call('create_node', { parentId: screenId, kind: 'Text',
      properties: { x: 10, y: 10 + index * 80, width: 300, height: 75, text: 'AAAA', fontFamily: familyName,
        fontSize: 40, fontWeight: weight, textColor: '#000000' } });
    ids.push(nodeId);
  }
  await page.locator('#screens .screen-select[data-screen-id="' + screenId + '"]').click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  for (const id of ids) {
    const surface = page.locator('#preview-viewport [data-visual-node="' + id + '"] .visual-surface');
    await expect(surface).toHaveCSS('font-family', /figvam-font-/);
  }
  const result = await call.raw('render_screen', { screenId });
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  const image = result.content.find(block => block.type === 'image');
  await compareNativePreview(page, image);
  const ink = await page.evaluate(async data => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bmp,0,0);
    return [0,80].map(y => {
      const pixels = ctx.getImageData(10, 10+y, 300, 75).data;
      let count = 0; for (let i=0;i<pixels.length;i+=4) if (pixels[i]<100 && pixels[i+1]<100 && pixels[i+2]<100) count++;
      return count;
    });
  }, image.data);
  expect(ink[0]).toBeGreaterThan(0);
  expect(ink[1]).toBeGreaterThan(ink[0] * 2);
  await page.close();
  const detached = await call.raw('render_screen', { screenId });
  expect(detached.isError, JSON.stringify(detached.structuredContent)).not.toBe(true);
  expect(detached.content.find(block => block.type === 'image').data).toBe(image.data);
});
