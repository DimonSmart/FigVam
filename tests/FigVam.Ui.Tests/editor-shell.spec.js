const { test, expect, bearer } = require('./fixtures');

async function openEditor(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Имя нового документа').fill('Editor shell test');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
}

test('editor shell gives the canvas first-screen priority and retains existing tools', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: rect('#viewport'), left: rect('.layers-sidebar'),
      right: rect('.properties-sidebar'), header: rect('.app-toolbar'),
      bodyScroll: document.documentElement.scrollHeight,
      leftOverflow: getComputedStyle(document.querySelector('.layers-master #pages')).overflowY,
      detailOverflow: getComputedStyle(document.querySelector('.layers-detail .layer-tree-group')).overflowY,
      detailHeight: rect('.layers-detail').height,
      layerSectionHeight: rect('.layers-detail .layer-tree-group').height,
      rightOverflow: getComputedStyle(document.querySelector('.inspector-page')).overflowY
    };
  });
  expect(geometry.header.height).toBeGreaterThanOrEqual(48);
  expect(geometry.header.height).toBeLessThanOrEqual(56);
  expect(geometry.viewport.height).toBeGreaterThan(550);
  expect(geometry.viewport.width).toBeGreaterThan(600);
  expect(geometry.left.width).toBeGreaterThanOrEqual(230);
  expect(geometry.right.width).toBeGreaterThanOrEqual(280);
  expect(geometry.bodyScroll).toBeLessThanOrEqual(902);
  expect(geometry.leftOverflow).toBe('auto');
  expect(geometry.detailOverflow).toBe('auto');
  expect(Math.abs(geometry.detailHeight - geometry.layerSectionHeight)).toBeLessThanOrEqual(2);
  expect(geometry.rightOverflow).toBe('auto');

  await expect(page.getByRole('tab', { name: 'Слои' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#canvas-empty')).toBeVisible();
  await expect(page.locator('#export-json')).toBeHidden();
  await page.locator('.document-menu > summary').click();
  await expect(page.locator('#export-json')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#export-json')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('editor-shell-empty.png') });

  await page.getByRole('button', { name: 'Создать страницу', exact: true }).click();
  await expect(page.locator('#pages button')).toHaveCount(1);
  await page.locator('#canvas-empty button').click();
  await expect(page.locator('#screen-create')).toBeVisible();
  await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  await page.locator('#screen-create button[type=submit]').click();
  await expect(page.locator('#pages > li > #screens')).toHaveCount(1);
  await expect(page.locator('#screen-boundary')).toBeVisible();
  await expect(page.locator('#canvas-empty')).toBeHidden();

  const created = page.waitForResponse(res => res.url().endsWith('/commands/add-node'));
  await page.getByRole('button', { name: 'Добавить контейнер' }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(page.locator('#layers [aria-selected=true]')).toHaveCount(1);
  await expect(page.locator('#visual-inspector')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor-shell-selected.png') });

  const selection = await page.locator('#layers [aria-selected=true]').getAttribute('data-id');
  const zoom = await page.locator('#zoom-level').textContent();
  await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
  await expect(page.locator('.layers-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
  await expect(page.locator('#layers [aria-selected=true]')).toHaveAttribute('data-id', selection);
  await expect(page.locator('#zoom-level')).toHaveText(zoom);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#editor-preview')).toBeVisible();
  const themes = page.getByRole('group', { name: 'Тема', exact: true });
  await expect(themes.getByRole('button', { name: 'Светлая тема' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('editor-shell-preview.png') });
  await themes.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect(themes.getByRole('button', { name: 'Тёмная тема' })).toHaveAttribute('aria-pressed', 'true');
  await expect(themes.getByRole('button', { name: 'Светлая тема' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('editor-shell-preview-dark.png') });
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await expect(page.locator('#layers [aria-selected=true]')).toHaveAttribute('data-id', selection);
});

test('screen presets initialize dimensions, follow manual edits, and reset together', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Создать страницу', exact: true }).click();

  const preset = page.getByLabel('Типовой размер экрана');
  const width = page.getByLabel('Ширина экрана');
  const height = page.getByLabel('Высота экрана');
  await expect(preset).toHaveValue('1440x900');
  await expect(width).toHaveValue('1440');
  await expect(height).toHaveValue('900');

  await preset.selectOption('390x844');
  await expect(width).toHaveValue('390');
  await expect(height).toHaveValue('844');
  await width.fill('420');
  await expect(preset).toHaveValue('custom');

  await preset.selectOption('768x1024');
  await expect(width).toHaveValue('768');
  await expect(height).toHaveValue('1024');
  await preset.selectOption('custom');
  await expect(width).toHaveValue('768');
  await expect(height).toHaveValue('1024');

  await width.fill('1440');
  await expect(preset).toHaveValue('custom');
  await height.fill('900');
  await expect(preset).toHaveValue('1440x900');

  await preset.selectOption('390x844');
  await page.locator('#screen-create').evaluate(form => form.reset());
  await expect(preset).toHaveValue('1440x900');
  await expect(width).toHaveValue('1440');
  await expect(height).toHaveValue('900');

  await page.locator('#screen-create button[type=submit]').click();
  await expect(page.locator('#screens button').first()).toContainText('1440 × 900');
});

for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 500 }]) {
  test(`navigator menus are not clipped at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openEditor(page);
    if (viewport.width <= 1050)
      await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
    await page.getByRole('button', { name: 'Создать страницу', exact: true }).click();

    async function expectUnclipped(selector) {
      const popup = page.locator(selector);
      await expect(popup).toBeVisible();
      await expect.poll(() => popup.evaluate(element => {
        const { left, right, top, bottom } = element.getBoundingClientRect();
        const points = [[left + 4, top + 4], [right - 4, top + 4],
          [left + 4, bottom - 4], [right - 4, bottom - 4]];
        return left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight &&
          points.every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
      })).toBe(true);
    }

    await expectUnclipped('.screen-options-body');
    await page.getByLabel('Типовой размер экрана').selectOption('390x844');
    await expect(page.getByLabel('Ширина экрана')).toHaveValue('390');
    await expect(page.getByLabel('Высота экрана')).toHaveValue('844');
    await page.locator('#screen-create button[type=submit]').click();
    await expect(page.locator('#screens .screen-select')).toHaveCount(1);

    await page.locator('#pages > li > .navigator-context-menu > summary').click();
    await expectUnclipped('#pages > li > .navigator-context-menu > .navigator-context-body');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pages > li > .navigator-context-menu > .navigator-context-body')).toBeHidden();
    await expect(page.locator('#pages > li > .navigator-context-menu > summary')).toBeFocused();
    await page.locator('#screens .navigator-context-menu > summary').click();
    await expectUnclipped('#screens .navigator-context-body');
    await expect(page.getByRole('button', { name: /Дублировать экран/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#screens .navigator-context-body')).toBeHidden();
  });
}

test('tokens are opened from the document toolbar without a duplicate resources shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await expect(page.getByRole('button', { name: 'Открыть токены', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Дизайн-система', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Стили оформления', exact: true })).toBeVisible();
  await page.locator('#document-mode-tokens').click();
  await expect(page.locator('#token-workspace')).toBeVisible();
  await page.locator('#document-mode-editor').click();
  await expect(page.locator('#token-workspace')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Стили оформления', exact: true })).toBeVisible();
});

test('narrow editor keeps full page unscrolled and panels accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('.layers-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
  await expect(page.locator('.layers-sidebar')).toBeVisible();
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await expect(page.locator('#asset-upload-form')).toBeVisible();
  await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
  await page.getByRole('button', { name: 'Показать или скрыть инспектор' }).click();
  await expect(page.locator('.properties-sidebar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor-shell-mobile.png') });
});

test('navigation and selected-screen layers are separate, resizable and keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Создать страницу', exact: true }).click();
  const pageNode = page.locator('#pages > li > .page-select');
  await expect(pageNode).toHaveAttribute('aria-expanded', 'true');

  await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  await page.locator('#screen-create button[type=submit]').click();
  await expect(page.locator('#pages > li > #screens .screen-select')).toHaveCount(1);
  await expect(page.locator('#layers')).toHaveAttribute('role', 'tree');

  const splitter = page.getByRole('separator', { name: 'Изменить высоту навигации и дерева слоёв' });
  const previous = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  await page.keyboard.press('ArrowDown');
  expect(Number(await splitter.getAttribute('aria-valuenow'))).toBe(previous + 5);
  await page.keyboard.press('ArrowUp');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(previous));

  await pageNode.click();
  await expect(pageNode).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#screens')).toBeHidden();
  await pageNode.click();
  await expect(page.locator('#screens')).toBeVisible();

  const response = page.waitForResponse(res => res.url().endsWith('/commands/add-node'));
  await page.getByRole('button', { name: 'Добавить контейнер' }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.locator('#layers [aria-selected=true]')).toHaveCount(1);
  await expect(page.locator('#pages > li > #screens .screen-select')).toHaveCount(1);
});
