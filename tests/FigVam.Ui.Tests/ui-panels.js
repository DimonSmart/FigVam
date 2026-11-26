const { expect } = require('@playwright/test');
// Explicit navigation helpers for Playwright scenarios using FigVam's application shell.
async function show(page, panel) {
  // Wait for async navigation to finish before testing responsive panel visibility.
  await expect(page.locator('#editor-view')).toBeVisible();
  if (panel === 'tokens') {
    await page.locator('#document-mode-tokens').click();
    await expect(page.locator('#token-workspace')).toBeVisible();
    return;
  }
  if (await page.locator('#token-workspace').isVisible()) {
    await page.locator('#document-mode-editor').click();
  }
  const tabs = {
    layers: 'tab-layers', components: 'tab-components', assets: 'tab-assets',
    design: 'tab-design', prototype: 'tab-prototype', diagnostics: 'tab-diagnostics'
  };
  const menus = {
    document: '.document-menu', share: '.share-menu',
    palette: '.palette-options', screen: '.screen-options',
    page: '#pages > li:has(> .page-select[aria-pressed="true"]) > .navigator-context-menu'
  };
  if (tabs[panel]) {
    const tab = page.locator('#' + tabs[panel]);
    const sidebar = await tab.evaluate(el => el.closest('aside')?.className || '');
    if (sidebar.includes('layers-sidebar') && await page.locator('.layers-sidebar').isHidden()) {
      await page.getByRole('button', { name: 'Показать или скрыть слои' }).click();
    }
    if (sidebar.includes('properties-sidebar') && await page.locator('.properties-sidebar').isHidden()) {
      await page.getByRole('button', { name: 'Показать или скрыть инспектор' }).click();
    }
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    await expect(page.locator('#' + (await tab.getAttribute('aria-controls')))).toBeVisible();
    return;
  }
  if (!menus[panel]) throw new Error('Unknown editor panel: ' + panel);
  if (panel === 'screen' || panel === 'page') await show(page, 'layers');
  // A newly added page is selected only after the server has committed the command.
  // Opening the form before that transition can make its controls disappear mid-fill.
  if (panel === 'screen' || panel === 'page') {
    await expect(page.locator('#pages > li > .page-select[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#page-edit')).not.toHaveAttribute('inert', '');
  }
  const details = page.locator(menus[panel]);
  if (!(await details.evaluate(node => node.open))) await details.locator(':scope > summary').click();
}
module.exports = { show };
