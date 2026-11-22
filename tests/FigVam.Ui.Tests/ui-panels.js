// Explicit navigation helpers for Playwright scenarios using FigVam's application shell.
async function show(page, panel) {
  const tabs = {
    layers: 'tab-layers', components: 'tab-components', assets: 'tab-assets',
    design: 'tab-design', prototype: 'tab-prototype', diagnostics: 'tab-diagnostics'
  };
  const menus = {
    document: '.document-menu', share: '.share-menu',
    palette: '.palette-options', screen: '.screen-options',
    page: '#page-edit > .inline-menu'
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
    return;
  }
  if (!menus[panel]) throw new Error('Unknown editor panel: ' + panel);
  if (panel === 'screen' || panel === 'page') await show(page, 'layers');
  const details = page.locator(menus[panel]);
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
}
module.exports = { show };
