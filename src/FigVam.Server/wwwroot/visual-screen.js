import { reconcileScreen, renderScreen } from './screen-renderer.js';
import { resolvePropertyToken } from './token-resolution.js';

export function createVisualScreens({ element, request, getContext, closeInaccessibleDocument, onDesignChange, onThemeChange }) {
  const boundary = element('screen-boundary');
  const viewport = element('preview-viewport');
  const openButton = element('open-preview');
  const closeButton = element('close-preview');
  const themeButtons = ['design-theme', 'preview-theme'].flatMap(id => [...element(id).querySelectorAll('button[data-theme]')]);
  let activeTheme = 'Light';
  function selectTheme(theme) {
    activeTheme = theme;
    for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
  const backButton = element('preview-back');
  const design = { host: boundary, status: element('design-render-status'), diagnostics: element('design-render-diagnostics'),
    retry: element('design-render-retry') };
  const preview = { host: viewport, status: element('preview-render-status'), diagnostics: element('preview-render-diagnostics'),
    retry: element('preview-render-retry') };
  let context = null, contextKey = null, controller = null;
  let isPreview = false, triggers = [], playback = null, playbackRequest = null, resizeTimer = null;
  let activeScenarios = [];
  const inputValues = new Map();
  const screenNodes = new Map(), screenScenarios = new Map(), assetUrls = new Map();
  let resources = null, loadedResources = null;
  const propertyPreviews = new Map();
  let previewFrame = 0;
  const previewKey = (documentId, screen, variantId) => JSON.stringify([documentId, screen, variantId ?? null]);
  const visualProperties = new Set(['visible', 'opacity', 'text', 'textColor', 'textAlignment', 'fontSize', 'fontFamily', 'fontFallback', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wrap', 'enabled', 'placeholder', 'value', 'multiline', 'inputType', 'backgroundColor', 'borderColor', 'borderWidth', 'cornerRadius', 'shadow', 'altText', 'fit', 'overflow']);

  function projected(model) {
    if (!context || !model) return model;
    const edits = propertyPreviews.get(previewKey(context.documentId, model.screen, context.variantId));
    if (!edits?.size) return model;
    const nodes = new Map(model.nodes), boxes = new Map(model.boxes), overrides = new Map(model.overrides);
    for (const [id, properties] of edits) {
      const node = nodes.get(id), box = boxes.get(id);
      if (!node || !box) continue;
      const definitions = model.kinds.get(node.kind)?.properties ?? {};
      const appearance = Object.fromEntries(Object.entries(properties).filter(([name]) => visualProperties.has(name)));
      nodes.set(id, { ...node, properties: { ...node.properties, ...appearance } });
      overrides.set(id, { ...overrides.get(id), ...appearance });
      const parent = nodes.get(node.parentId);
      const parentLayout = parent && (parent.properties.layout ?? model.kinds.get(parent.kind)?.properties.layout?.defaultValue)?.value;
      // Do not approximate stack/auto-sizing or container geometry: server layout is authoritative.
      if ((parent && parentLayout !== 'Free') || model.kinds.get(node.kind)?.canContainChildren || !boxes.has(node.parentId)) continue;
      const parentBounds = boxes.get(node.parentId).bounds, bounds = { ...box.bounds };
      for (const name of ['x', 'y', 'width', 'height']) {
        const raw = properties[name];
        if (!raw) continue;
        if ((name === 'width' || name === 'height') && (node.properties[name + 'Mode'] ?? definitions[name + 'Mode']?.defaultValue)?.value !== 'Fixed') continue;
        const value = raw.type === 'token' ? resolvePropertyToken(raw, model.tokens, activeTheme, definitions[name]).value : raw;
        if (Number.isFinite(value?.value)) bounds[name] = value.value + (name === 'x' || name === 'y' ? parentBounds[name] : 0);
      }
      boxes.set(id, { ...box, bounds });
    }
    return { ...model, nodes, boxes, overrides };
  }

  function setPropertyPreview(target, properties) {
    const key = previewKey(target.documentId, target.screen, target.variantId);
    if (!propertyPreviews.has(key)) propertyPreviews.set(key, new Map());
    const edits = propertyPreviews.get(key);
    if (Object.keys(properties).length) edits.set(target.nodeId, properties);
    else edits.delete(target.nodeId);
    if (!edits.size) propertyPreviews.delete(key);
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!context || isPreview || !design.model || design.model.revision !== context.revision || design.model.theme !== activeTheme) return;
      const drawing = renderScreen({ ...projected(design.model), theme: activeTheme }, { preview: false, report: () => {} });
      reconcileScreen(design.host, drawing.root);
    });
  }

  function cancelView(view) {
    view.controller?.abort();
    view.key = null;
  }

  function resetView(view) {
    cancelView(view);
    view.host.replaceChildren();
    view.status.textContent = '';
    view.diagnostics.replaceChildren();
    view.retry.hidden = true;
    if (view === design) design.model = null;
  }

  function showMode(next) {
    isPreview = next;
    element('editor-design').hidden = next;
    element('editor-preview').hidden = !next;
    onDesignChange();
    if (!next) {
      playbackRequest?.abort();
      playbackRequest = null;
      playback = null;
      triggers = [];
      inputValues.clear();
      resetView(preview);
    }
  }

  function syncSelection() {
    const id = getContext().selection?.id;
    design.selected?.removeAttribute('data-selected');
    design.selected = id ? boundary.querySelector(`[data-visual-node="${CSS.escape(id)}"]`) : null;
    if (design.selected) design.selected.dataset.selected = 'true';
    onDesignChange();
  }

  function refresh(nodeEdit = false) {
    const next = getContext();
    const key = next.screen && Number.isSafeInteger(next.revision) ?
      `${next.documentId}:${next.screen.id}:${next.revision}:${next.variantId ?? "base"}` : null;
    openButton.disabled = !key;
    if (contextKey === key) return;
    const sameScreen = next.documentId === context?.documentId && next.screen?.id === context?.screen.id;
    contextKey = key;
    controller?.abort();
    controller = new AbortController();
    playbackRequest?.abort();
    playbackRequest = null;
    // Immutable asset IDs may reuse their loaded URL while editing this screen.
    if (!sameScreen || !key) {
      for (const url of assetUrls.values()) url.then(URL.revokeObjectURL, () => {});
      assetUrls.clear();
    }
    if (!sameScreen || !nodeEdit) loadedResources = null;
    resources = loadedResources ? Promise.resolve(loadedResources) : null;
    screenNodes.clear();
    screenScenarios.clear();
    if (!sameScreen || !key) {
      showMode(false);
      resetView(design);
    } else {
      cancelView(design);
      cancelView(preview);
    }
    context = key ? next : null;
    if (!sameScreen || !key) design.model = null;
    onDesignChange();
    if (!context) return;
    if (isPreview && triggers.length) replay(triggers, null, true);
    else renderActive();
  }

  function readPath(path, params, signal) {
    const revision = context.revision;
    const base = `/api/v1/documents/${context.documentId}`;
    const query = new URLSearchParams({ revision, ...params });
    return request(`${base}/${path}?${query}`, {}, signal).then(result => {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (result.revision !== revision) throw new Error('Получен ответ для другой ревизии документа.');
      return result;
    });
  }

  async function readPages(path, params, field, signal) {
    let total;
    const items = [], diagnostics = [], overrides = [];
    do {
      const page = await readPath(path, { ...params, limit: 100, offset: items.length }, signal);
      total = page.total;
      const values = page[field];
      if (!Array.isArray(values) || !Number.isSafeInteger(total) || total < items.length + values.length ||
        page.offset !== items.length || !values.length && items.length < total)
        throw new Error('Сервер вернул неполный список компонентов или геометрии.');
      if (!items.length) diagnostics.push(...(page.diagnostics ?? []));
      items.push(...values);
      overrides.push(...(page.overrides ?? []));
    } while (items.length < total);
    return { items, diagnostics, overrides };
  }

  function readResources() {
    if (resources) return resources;
    const signal = controller.signal;
    const tokens = new Map(context.tokens.map(token => [token.id, token]));
    const styles = new Map((context.styles ?? []).map(style => [style.id, style]));
    const loading = Promise.all([readPath('profile', {}, signal), readPath('assets', {}, signal)])
      .then(([profile, manifest]) => {
        const result = { kinds: new Map(profile.kinds.map(kind => [kind.kind, kind])),
          assets: new Map(manifest.assets.map(asset => [asset.id, asset])), tokens, styles };
        if (resources === loading) loadedResources = result;
        return result;
      }).catch(error => {
        if (resources === loading) resources = null;
        throw error;
      });
    resources = loading;
    return loading;
  }

  function readCached(cache, key, read) {
    if (!cache.has(key)) {
      const loading = read().catch(error => {
        if (cache.get(key) === loading) cache.delete(key);
        throw error;
      });
      cache.set(key, loading);
    }
    return cache.get(key);
  }

  function readNodes(screen) {
    return readCached(screenNodes, screen, () => readPages('nodes',
      { screenId: screen, fields: 'kind,properties,name,parentId,childCount,canContainChildren' }, 'items', controller.signal));
  }

  async function readDesignModel() {
    const current = context;
    const variant = current.variantId;
    const [shared, structure, variants] = await Promise.all([
      readResources(), readNodes(current.screen.id),
      variant ? readPath(`screens/${current.screen.id}/variants`,
        { variantId: variant, offset: 0, limit: 1 }, controller.signal) : null
    ]);
    const overrides = new Map();
    for (const item of variants?.items?.[0]?.overrides ?? []) {
      if (!overrides.has(item.nodeId)) overrides.set(item.nodeId, {});
      overrides.get(item.nodeId)[item.property] = item.value;
    }
    return {
      ...shared, overridden: new Map([...overrides].map(([id, values]) => [id, new Set(Object.keys(values))])),
      nodes: new Map(structure.items.map(node => [node.id, {
        ...node, properties: { ...node.properties, ...overrides.get(node.id) }
      }]))
    };
  }

  async function readScreen(screen, parameters, signal) {
    const documentSignal = controller.signal;
    const [shared, structure, layout, scenarios] = await Promise.all([
      readResources(),
      readNodes(screen),
      readPages(`screens/${screen}/layout`, parameters ?? {}, 'boxes', signal),
      parameters?.previewWidth != null ? readCached(screenScenarios, screen, () => readPages('scenarios', { screenId: screen }, 'items', documentSignal)) : null
    ]);
    return {
      ...shared, screen, revision: context.revision, scenarios: scenarios?.items ?? [], diagnostics: layout.diagnostics,
      orderedNodes: structure.items,
      nodes: new Map(structure.items.map(node => [node.id, {
        ...node, properties: { ...node.properties,
          ...(layout.overrides ?? []).find(item => item.nodeId === node.id)?.properties }
      }])),
      boxes: new Map(layout.items.map(box => [box.objectId, box])),
      overrides: new Map((layout.overrides ?? []).map(item => [item.nodeId, item.properties]))
    };
  }

  function readAsset(id) {
    const { documentId, revision } = context;
    const signal = controller.signal;
    return readCached(assetUrls, id, async () => {
      const data = await request.readPng(`/api/v1/documents/${documentId}/assets/${id}?revision=${revision}`, {}, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return URL.createObjectURL(data);
    });
  }

  function addDiagnostic(list, description) {
    if ([...list.children].some(item => item.textContent === description)) return;
    const item = document.createElement('li');
    item.textContent = description;
    list.append(item);
  }

  function displayInput(id, initial) {
    if (inputValues.has(id)) return inputValues.get(id);
    return playback && Object.hasOwn(playback.values, id) ? playback.values[id] ?? '' : initial;
  }

  function sizePreview() {
    const { width, height } = context.screen.dimensions;
    viewport.style.width = `min(100%, ${width}px)`;
    viewport.style.height = `min(${height}px, max(1px, calc(100dvh - 12rem)))`;
    const bounds = viewport.getBoundingClientRect();
    return { width: Math.min(width, bounds.width), height: Math.min(height, bounds.height) };
  }

  function renderActive() {
    if (!context) return;
    if (isPreview) {
      const size = sizePreview();
      const selection = playback?.selection;
      const parameters = { previewWidth: size.width, previewHeight: size.height, theme: activeTheme };
      if (selection?.datasetId) parameters.datasetId = selection.datasetId;
      loadView(preview, [selection?.screenId ?? context.screen.id, ...(playback?.overlays ?? [])], parameters, selection ? selection.variantId : context.variantId);
    } else loadView(design, [context.screen.id], { theme: activeTheme }, context.variantId);
  }

  async function loadView(view, screens, parameters, variantId) {
    const previewMode = view === preview;
    const theme = activeTheme;
    const key = JSON.stringify([screens, parameters, variantId, theme, playback?.values]);
    if (view.key === key) return;
    cancelView(view);
    view.key = key;
    const signal = (view.controller = new AbortController()).signal;
    const current = () => !signal.aborted && isPreview === previewMode;
    const drawingContext = context;
    const acceptsInteraction = () => context === drawingContext && isPreview === previewMode &&
      (!previewMode || screens.at(-1) === (playback?.overlays.at(-1) ?? playback?.selection.screenId ?? context.screen.id));
    if (!view.host.hasChildNodes()) view.status.textContent = 'Загрузка экрана…';
    view.retry.hidden = true;
    try {
      const reads = new Map();
      const models = await Promise.all(screens.map((screen, index) => {
        const variant = index === 0 ? variantId : null;
        const key = `${screen}:${variant ?? ''}`;
        if (!reads.has(key)) reads.set(key, readScreen(screen, variant ? { ...(parameters ?? {}), variantId: variant } : parameters, signal));
        return reads.get(key);
      }));
      if (!current()) return;
      const diagnostics = document.createDocumentFragment(), content = document.createDocumentFragment();
      let shown = false;
      for (const [index, model] of models.entries()) {
        const { screen, boxes } = model;
        for (const item of model.diagnostics) {
          const name = model.nodes.get(item.objectId)?.name || item.objectId;
          addDiagnostic(diagnostics, `${name} · ${item.property}: ${item.message} (${item.code})`);
        }
        if (!boxes.has(screen)) continue;
        const drawing = renderScreen({ ...(previewMode ? model : projected(model)), theme }, {
          preview: previewMode, trigger: (id, event) => acceptsInteraction() && trigger(id, event),
          getInput: previewMode ? displayInput : undefined,
          setInput: (id, value) => { if (acceptsInteraction()) inputValues.set(id, value); },
          report: (node, property, message) => addDiagnostic(diagnostics, `${node.name || node.id} · ${property}: ${message}`)
        });
        if (previewMode) {
          const surface = document.createElement('div');
          const bounds = boxes.get(screen).bounds;
          surface.className = 'preview-screen';
          surface.dataset.previewScreen = screen;
          surface.style.width = `${bounds.width}px`;
          surface.style.height = `${bounds.height}px`;
          surface.inert = index !== models.length - 1;
          surface.append(drawing.root);
          content.append(surface);
        } else content.append(drawing.root);
        shown = true;
      }
      const focus = view.host.contains(document.activeElement) ? document.activeElement : null;
      const focusedNode = focus?.closest('[data-visual-node]')?.dataset.visualNode;
      const selection = focus?.matches('input, textarea') ? [focus.selectionStart, focus.selectionEnd, focus.selectionDirection] : null;
      if (!previewMode && view.host.hasChildNodes()) reconcileScreen(view.host, content);
      else view.host.replaceChildren(content);
      view.diagnostics.replaceChildren(diagnostics);
      view.status.textContent = shown ? '' : 'Геометрию экрана не удалось рассчитать.';
      if (previewMode) {
        activeScenarios = models.at(-1).scenarios;
        onDesignChange();
      }
      else {
        design.model = shown ? { ...models[0], theme } : null;
        syncSelection();
      }
      if (focusedNode) {
        const control = (previewMode ? view.host.lastElementChild : view.host)
          ?.querySelector(`[data-visual-node="${CSS.escape(focusedNode)}"] > .visual-surface`);
        if (control && !control.inert && !control.disabled) {
          control.focus({ preventScroll: true });
          if (selection && control.matches('input, textarea')) control.setSelectionRange(...selection);
        } else if (previewMode) closeButton.focus({ preventScroll: true });
      }
      // Existing image nodes retain their loaded asset and do not fetch it again.
      for (const surface of view.host.querySelectorAll('img[data-asset-id]')) {
        const assetId = surface.dataset.assetId;
        if (surface.dataset.loadedAsset === assetId) continue;
        const report = () => {
          if (current()) addDiagnostic(view.diagnostics, `${surface.alt || assetId} · asset: Не удалось загрузить изображение.`);
        };
        surface.onerror = report;
        readAsset(assetId).then(url => {
          if (current() && surface.isConnected && surface.dataset.assetId === assetId) {
            surface.onload = () => {
              if (surface.dataset.assetId === assetId) surface.dataset.loadedAsset = assetId;
            };
            surface.src = url;
          }
        }).catch(report);
      }
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      if (error.status === 403) { closeInaccessibleDocument(403); return; }
      view.key = null;
      view.captureStamp = null;
      if (!view.host.hasChildNodes()) view.diagnostics.replaceChildren();
      view.status.textContent = `Не удалось показать экран. ${error.message}`;
      view.retry.hidden = false;
      if (previewMode) onDesignChange();
    }
  }

  async function replay(next, matchingScenarios, afterRefresh = false) {
    if (playbackRequest || !isPreview) return;
    const active = playbackRequest = new AbortController();
    const { documentId, revision, screen } = context;
    const size = sizePreview();
    try {
      const body = {
        revision, triggers: next, selection: {
          screenId: screen.id, variantId: context.variantId, datasetId: null, theme: activeTheme === 'Dark' ? 1 : 0,
          viewport: { width: Math.max(1, size.width), height: Math.max(1, size.height) }
        }
      };
      const result = await request(`/api/v1/documents/${documentId}/preview`,
        { method: 'POST', body: JSON.stringify(body) }, active.signal);
      if (playbackRequest !== active || active.signal.aborted) return;
      if (result.revision !== revision || result.documentId !== documentId || !result.session?.selection?.screenId ||
        !Array.isArray(result.session.overlays) || !result.session.values)
        throw new Error('Получен некорректный результат сценария.');
      for (const scenario of matchingScenarios ?? []) {
        for (const action of scenario.actions) {
          if (action.type === 'setDemoValue' && inputValues.delete(action.nodeId)) preview.key = null;
          if (action.type === 'resetPreview') { inputValues.clear(); preview.key = null; }
        }
      }
      triggers = next;
      playback = result.session;
      backButton.disabled = !playback.canGoBack;
      renderActive();
    } catch (error) {
      if (playbackRequest !== active || active.signal.aborted) return;
      if (error.status === 403) { closeInaccessibleDocument(403); return; }
      if (afterRefresh) {
        triggers = [];
        playback = null;
        backButton.disabled = true;
        renderActive();
      } else preview.status.textContent = `Не удалось выполнить сценарий. ${error.message}`;
    } finally {
      if (playbackRequest === active) playbackRequest = null;
    }
  }

  function trigger(nodeId, event) {
    const scenarios = activeScenarios.filter(item => item.nodeId === nodeId && item.event === event);
    if (!scenarios.length) return;
    if (triggers.length >= 128) {
      preview.status.textContent = 'Достигнут предел истории сценария. Сбросьте Preview, чтобы продолжить.';
      return;
    }
    replay([...triggers, { nodeId, event }], scenarios);
  }

  openButton.addEventListener('click', () => {
    if (!context) return;
    if (design.status.textContent === 'Загрузка экрана…') cancelView(design);
    backButton.disabled = true;
    showMode(true);
    if (context.variantId) replay([], null);
    else renderActive();
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => {
    showMode(false);
    renderActive();
    openButton.focus();
  });
  for (const button of themeButtons) button.addEventListener('click', () => {
    if (activeTheme === button.dataset.theme) return;
    selectTheme(button.dataset.theme);
    cancelView(design);
    design.model = null;
    onDesignChange();
    onThemeChange();
    if (isPreview && (playbackRequest || triggers.length || context?.variantId)) {
      playbackRequest?.abort();
      playbackRequest = null;
      cancelView(preview);
      replay(triggers, null, true);
    } else renderActive();
  });
  design.retry.addEventListener('click', renderActive);
  preview.retry.addEventListener('click', renderActive);
  element('preview-reset').addEventListener('click', () => {
    playbackRequest?.abort();
    playbackRequest = null;
    triggers = [];
    playback = null;
    inputValues.clear();
    backButton.disabled = true;
    cancelView(preview);
    renderActive();
  });
  backButton.addEventListener('click', () => {
    if (triggers.length) replay(triggers.slice(0, -1));
  });
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    if (isPreview) resizeTimer = setTimeout(() => {
      if (isPreview && !playbackRequest) renderActive();
    }, 120);
  }).observe(viewport);
  return { get currentTheme() { return activeTheme; }, refresh, syncSelection, readDesignModel, setPropertyPreview, clearPropertyPreviews() { propertyPreviews.clear(); }, get designModel() { return !isPreview && design.model?.revision === context?.revision ? design.model : null; } };
}
