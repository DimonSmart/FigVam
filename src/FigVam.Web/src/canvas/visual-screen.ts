import { reconcileScreen, renderScreen, type RenderModel } from './screen-renderer.js';
import { resolvePropertyToken } from '../core/tokens/token-resolution';
import { number, node, kind, box, properties, token, nodeProperty } from './render-model';
import { requiredRecord, text, array, errorMessage, aborted } from '../api/decode';
import { ApiError, type ApiClient } from '../api/api-client';
import type { components } from '../api/schema.generated';
import type { DesignToken, NodePropertyValue, ResolvableValue, Theme } from '../core/tokens/token-model';
import type { CanvasNode, CanvasKind, LayoutBox, NodeProperties } from './canvas-model';
type Schema=components['schemas'];
type PreviewTrigger=Schema['PreviewTrigger'];
type PreviewAction={type:'setDemoValue';nodeId:string}|{type:'resetPreview'}|{type:'other'};
interface Scenario {nodeId:string;event:number;actions:PreviewAction[]}
interface Playback {selection:{screenId:string;datasetId:string|null;variantId:string|null};overlays:string[];values:Record<string,string|null>;canGoBack:boolean}
interface Asset {id:string;width:number;height:number}
interface Style {id:string;name:string;type:number|string}
interface Resources {kinds:Map<string,CanvasKind & {kind:string}>;assets:Map<string,Asset>;tokens:Map<string,DesignToken>;styles:Map<string,Style>}
interface DrawingModel extends Omit<RenderModel,'theme'|'assets'|'kinds'|'tokens'>, Resources {
  screen:string;revision:number;scenarios:Scenario[];diagnostics:Diagnostic[];orderedNodes:CanvasNode[];
}
interface Diagnostic {objectId:string;property:string;message:string;code:string}
interface View {host:HTMLElement;status:HTMLElement;diagnostics:HTMLElement;retry:HTMLElement;controller:AbortController|null;key:string|null;model:DrawingModel|null;selected:HTMLElement|null;captureStamp?:string|null}
interface Screen {id:string;dimensions:{width:number;height:number}}
interface InputContext {documentId:string|null;revision:number|null;screen?:Screen;selection?:{id:string}|null;tokens:unknown[];styles?:unknown[];variantId:string|null}
type Context=Omit<InputContext,'documentId'|'revision'|'screen'>&{documentId:string;revision:number;screen:Screen};
interface Options {element(id:string):HTMLElement;request:ApiClient;getContext():InputContext;closeInaccessibleDocument(status:number):void;onDesignChange():void}
type Query=Record<string,string|number>;
interface Page<T>{items:T[];diagnostics:Diagnostic[];overrides:{nodeId:string;properties:NodeProperties}[]}
function diagnostic(value:unknown):Diagnostic{const d=requiredRecord(value);return{objectId:text(d.objectId),property:text(d.property),message:text(d.message),code:text(d.code)};}
function scenario(value:unknown):Scenario{const v=requiredRecord(value);return{nodeId:text(v.nodeId),event:number(v.event),actions:array(v.actions,a=>{const x=requiredRecord(a);return x.type==='setDemoValue'?{type:'setDemoValue',nodeId:text(x.nodeId)}:x.type==='resetPreview'?{type:'resetPreview'}:{type:'other'};})};}
function playbackValue(value:unknown):Playback{const p=requiredRecord(value),selection=requiredRecord(p.selection);return{selection:{screenId:text(selection.screenId),datasetId:selection.datasetId==null?null:text(selection.datasetId),variantId:selection.variantId==null?null:text(selection.variantId)},overlays:array(p.overlays,text),values:Object.fromEntries(Object.entries(requiredRecord(p.values)).map(([id,v])=>[id,v==null?null:text(v)])),canGoBack:p.canGoBack===true};}
function asset(value:unknown):Asset{const a=requiredRecord(value);return{id:text(a.id),width:number(a.width),height:number(a.height)};}
function style(value:unknown):Style{const a=requiredRecord(value);return{id:text(a.id),name:text(a.name),type:typeof a.type==='number'?a.type:text(a.type)};}
function scalar(value:ResolvableValue|null|undefined):unknown{return value&&'value' in value?value.value:undefined;}
function button(value:HTMLElement):HTMLButtonElement{if(!(value instanceof HTMLButtonElement))throw new Error('Expected button');return value;}
function newView(host:HTMLElement,status:HTMLElement,diagnostics:HTMLElement,retry:HTMLElement):View{return{host,status,diagnostics,retry,controller:null,key:null,model:null,selected:null};}
function inputControl(el:Element|null):el is HTMLInputElement|HTMLTextAreaElement{return el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement;}


export function createVisualScreens({ element, request, getContext, closeInaccessibleDocument, onDesignChange }:Options) {
  const boundary = element('screen-boundary');
  const viewport = element('preview-viewport');
  const openButton = button(element('open-preview'));
  const closeButton = button(element('close-preview'));
  const themeButtons = [...element('preview-theme').querySelectorAll<HTMLButtonElement>('button[data-theme]')];
  let previewTheme:Theme = 'Light';
  function selectTheme(theme:Theme) {
    previewTheme = theme;
    for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
  const backButton = button(element('preview-back'));
  const design=newView(boundary,element('design-render-status'),element('design-render-diagnostics'),element('design-render-retry'));
  const preview=newView(viewport,element('preview-render-status'),element('preview-render-diagnostics'),element('preview-render-retry'));
  let context:Context|null=null,contextKey:string|null=null,controller:AbortController|null=null;
  let isPreview=false,triggers:PreviewTrigger[]=[],playback:Playback|null=null,playbackRequest:AbortController|null=null,resizeTimer:ReturnType<typeof setTimeout>|undefined;
  let activeScenarios:Scenario[]=[];
  const inputValues=new Map<string,string>();
  const screenNodes=new Map<string,Promise<Page<CanvasNode>>>(),screenScenarios=new Map<string,Promise<Page<Scenario>>>(),assetUrls=new Map<string,Promise<string>>();
  let resources:Promise<Resources>|null=null,loadedResources:Resources|null=null;
  const propertyPreviews=new Map<string,Map<string,NodeProperties>>();
  function currentContext():Context{if(!context)throw new Error('No active screen');return context;}
  function documentSignal():AbortSignal{if(!controller)throw new Error('No active screen request');return controller.signal;}
  let previewFrame = 0;
  const previewKey = (documentId:string|null, screen:string, variantId:string|null|undefined) => JSON.stringify([documentId, screen, variantId ?? null]);
  const visualProperties = new Set(['visible', 'opacity', 'text', 'textColor', 'textAlignment', 'fontSize', 'fontFamily', 'fontFallback', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wrap', 'enabled', 'placeholder', 'value', 'multiline', 'inputType', 'backgroundColor', 'borderColor', 'borderWidth', 'cornerRadius', 'shadow', 'altText', 'fit', 'overflow']);

  function projected(model:DrawingModel):DrawingModel {
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
      const parentLayout = parent && scalar(parent.properties.layout ?? model.kinds.get(parent.kind)?.properties.layout?.defaultValue);
      // Do not approximate stack/auto-sizing or container geometry: server layout is authoritative.
      if ((parent && parentLayout !== 'Free') || model.kinds.get(node.kind)?.canContainChildren || !boxes.has(node.parentId)) continue;
      const parentBounds = boxes.get(node.parentId)?.bounds, bounds = { ...box.bounds };
      if(!parentBounds)continue;
      for (const name of ['x', 'y', 'width', 'height'] as const) {
        const raw = properties[name];
        if (!raw) continue;
        if ((name === 'width' || name === 'height') && scalar(node.properties[name + 'Mode'] ?? definitions[name + 'Mode']?.defaultValue) !== 'Fixed') continue;
        const value = raw.type === 'token' ? resolvePropertyToken(raw, model.tokens, 'Light', definitions[name]??{}).value : raw;
        const n=scalar(value);
        if (typeof n==='number'&&Number.isFinite(n)) bounds[name] = n + (name === 'x' || name === 'y' ? parentBounds[name] : 0);
      }
      boxes.set(id, { ...box, bounds });
    }
    return { ...model, nodes, boxes, overrides };
  }

  function setPropertyPreview(target:{documentId:string|null;screen:string;variantId?:string|null;nodeId:string}, properties:NodeProperties) {
    const key = previewKey(target.documentId, target.screen, target.variantId);
    if (!propertyPreviews.has(key)) propertyPreviews.set(key, new Map());
    const edits = propertyPreviews.get(key);
    if(!edits)return;
    if (Object.keys(properties).length) edits.set(target.nodeId, properties);
    else edits.delete(target.nodeId);
    if (!edits.size) propertyPreviews.delete(key);
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!context || isPreview || !design.model || design.model.revision !== context.revision) return;
      const drawing = renderScreen({ ...projected(design.model), theme: 'Light' }, { preview: false, report: () => {} });
      reconcileScreen(design.host, drawing.root);
    });
  }

  function cancelView(view:View) {
    view.controller?.abort();
    view.key = null;
  }

  function resetView(view:View) {
    cancelView(view);
    view.host.replaceChildren();
    view.status.textContent = '';
    view.diagnostics.replaceChildren();
    view.retry.hidden = true;
    if (view === design) design.model = null;
  }

  function showMode(next:boolean) {
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
    design.selected = id ? boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(id)}"]`) : null;
    if (design.selected) design.selected.dataset.selected = 'true';
    onDesignChange();
  }

  function refresh(nodeEdit = false) {
    const next = getContext();
    const nextContext:Context|null=next.screen&&next.documentId&&typeof next.revision==='number'&&Number.isSafeInteger(next.revision)?{...next,screen:next.screen,documentId:next.documentId,revision:next.revision}:null;
    const key = nextContext ?
      `${nextContext.documentId}:${nextContext.screen.id}:${nextContext.revision}:${nextContext.variantId ?? "base"}` : null;
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
    context = nextContext;
    if (!sameScreen || !key) design.model = null;
    onDesignChange();
    if (!context) return;
    if (isPreview && triggers.length) replay(triggers, null, true);
    else renderActive();
  }

  function readPath(path:string, params:Query, signal:AbortSignal) {
    const {revision,documentId}=currentContext();
    const base = `/api/v1/documents/${documentId}`;
    const query = new URLSearchParams(Object.entries({ revision, ...params }).map(([k,v])=>[k,String(v)]));
    return request(`${base}/${path}?${query}`, {}, signal).then(value => {
      const result=requiredRecord(value);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (result.revision !== revision) throw new Error('Получен ответ для другой ревизии документа.');
      return result;
    });
  }

  async function readPages<T>(path:string, params:Query, field:string, signal:AbortSignal,decode:(v:unknown)=>T):Promise<Page<T>> {
    let total:number;
    const items:T[] = [], diagnostics:Diagnostic[] = [], overrides:Page<T>['overrides'] = [];
    do {
      const page = await readPath(path, { ...params, limit: 100, offset: items.length }, signal);
      total = number(page.total);
      const values = page[field];
      if (!Array.isArray(values) || !Number.isSafeInteger(total) || total < items.length + values.length ||
        page.offset !== items.length || !values.length && items.length < total)
        throw new Error('Сервер вернул неполный список компонентов или геометрии.');
      if (!items.length) diagnostics.push(...array(page.diagnostics??[],diagnostic));
      items.push(...values.map(decode));
      overrides.push(...array(page.overrides??[],value=>{const o=requiredRecord(value);return{nodeId:text(o.nodeId),properties:properties(o.properties)};}));
    } while (items.length < total);
    return { items, diagnostics, overrides };
  }

  function readResources() {
    if (resources) return resources;
    const signal=documentSignal(),ctx=currentContext();
    const tokens=new Map(ctx.tokens.map(token).map(t=>[t.id,t]));
    const styles=new Map((ctx.styles??[]).map(style).map(s=>[s.id,s]));
    const loading = Promise.all([readPath('profile', {}, signal), readPath('assets', {}, signal)])
      .then(([profile, manifest]) => {
        const result = { kinds: new Map(array(profile.kinds,kind).map(k=>[k.kind,k])),
          assets: new Map(array(manifest.assets,asset).map(a=>[a.id,a])), tokens, styles };
        if (resources === loading) loadedResources = result;
        return result;
      }).catch(error => {
        if (resources === loading) resources = null;
        throw error;
      });
    resources = loading;
    return loading;
  }

  function readCached<T>(cache:Map<string,Promise<T>>, key:string, read:()=>Promise<T>):Promise<T> {
    if (!cache.has(key)) {
      const loading = read().catch(error => {
        if (cache.get(key) === loading) cache.delete(key);
        throw error;
      });
      cache.set(key, loading);
    }
    const result=cache.get(key);if(!result)throw new Error('Missing cached resource');return result;
  }

  function readNodes(screen:string) {
    return readCached(screenNodes, screen, () => readPages('nodes',
      { screenId: screen, fields: 'kind,properties,name,parentId,childCount,canContainChildren' }, 'items', documentSignal(),node));
  }

  async function readDesignModel() {
    const current = currentContext();
    const variant = current.variantId;
    const [shared, structure, variants] = await Promise.all([
      readResources(), readNodes(current.screen.id),
      variant ? readPath(`screens/${current.screen.id}/variants`,
        { variantId: variant, offset: 0, limit: 1 }, documentSignal()) : null
    ]);
    const overrides = new Map<string,NodeProperties>();
    const variantItem=variants?array(variants.items,requiredRecord)[0]:null;
    for (const item of array(variantItem?.overrides??[],requiredRecord)) {
      const id=text(item.nodeId), values=overrides.get(id)??{};
      values[text(item.property)]=nodeProperty(item.value);overrides.set(id,values);
    }
    return {
      ...shared, overridden: new Map([...overrides].map(([id, values]) => [id, new Set(Object.keys(values))])),
      nodes: new Map(structure.items.map(node => [node.id, {
        ...node, properties: { ...node.properties, ...overrides.get(node.id) }
      }]))
    };
  }

  async function readScreen(screen:string, parameters:Query|null, signal:AbortSignal):Promise<DrawingModel> {
    const currentSignal = documentSignal();
    const [shared, structure, layout, scenarios] = await Promise.all([
      readResources(),
      readNodes(screen),
      readPages(`screens/${screen}/layout`, parameters ?? {}, 'boxes', signal,box),
      parameters ? readCached(screenScenarios, screen, () => readPages('scenarios', { screenId: screen }, 'items', currentSignal,scenario)) : null
    ]);
    return {
      ...shared, screen, revision: currentContext().revision, scenarios: scenarios?.items ?? [], diagnostics: layout.diagnostics,
      orderedNodes: structure.items,
      nodes: new Map(structure.items.map(node => [node.id, {
        ...node, properties: { ...node.properties,
          ...(layout.overrides ?? []).find(item => item.nodeId === node.id)?.properties }
      }])),
      boxes: new Map(layout.items.map(box => [box.objectId, box])),
      overrides: new Map((layout.overrides ?? []).map(item => [item.nodeId, item.properties]))
    };
  }

  function readAsset(id:string) {
    const { documentId, revision } = currentContext();
    const signal = documentSignal();
    return readCached(assetUrls, id, async () => {
      const data = await request.readPng(`/api/v1/documents/${documentId}/assets/${id}?revision=${revision}`, {}, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return URL.createObjectURL(data);
    });
  }

  function addDiagnostic(list:HTMLElement|DocumentFragment, description:string) {
    if ([...list.children].some(item => item.textContent === description)) return;
    const item = document.createElement('li');
    item.textContent = description;
    list.append(item);
  }

  function displayInput(id:string, initial:string) {
    const entered=inputValues.get(id);if(entered!==undefined)return entered;
    return playback && Object.hasOwn(playback.values, id) ? playback.values[id] ?? '' : initial;
  }

  function sizePreview() {
    const { width, height } = currentContext().screen.dimensions;
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
      const parameters:Query = { previewWidth: size.width, previewHeight: size.height, theme: previewTheme };
      if (selection?.datasetId) parameters.datasetId = selection.datasetId;
      loadView(preview, [selection?.screenId ?? context.screen.id, ...(playback?.overlays ?? [])], parameters, selection ? selection.variantId : context.variantId);
    } else loadView(design, [context.screen.id], null, context.variantId);
  }

  async function loadView(view:View, screens:string[], parameters:Query|null, variantId:string|null) {
    const previewMode = view === preview;
    const theme:Theme = previewMode ? previewTheme : 'Light';
    const key = JSON.stringify([screens, parameters, variantId, theme, playback?.values]);
    if (view.key === key) return;
    cancelView(view);
    view.key = key;
    const signal = (view.controller = new AbortController()).signal;
    const current = () => !signal.aborted && isPreview === previewMode;
    const drawingContext = context;
    const acceptsInteraction = () => context === drawingContext && isPreview === previewMode &&
      (!previewMode || screens.at(-1) === (playback?.overlays.at(-1) ?? playback?.selection.screenId ?? context?.screen.id));
    if (!view.host.hasChildNodes()) view.status.textContent = 'Загрузка экрана…';
    view.retry.hidden = true;
    try {
      const reads = new Map<string,Promise<DrawingModel>>();
      const models = await Promise.all(screens.map((screen, index) => {
        const variant = index === 0 ? variantId : null;
        const key = `${screen}:${variant ?? ''}`;
        if (!reads.has(key)) reads.set(key, readScreen(screen, variant ? { ...(parameters ?? {}), variantId: variant } : parameters, signal));
        const read=reads.get(key);if(!read)throw new Error('Missing screen read');return read;
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
          const bounds = boxes.get(screen)?.bounds;
          if(!bounds)continue;
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
      const focusedNode = focus?.closest<HTMLElement>('[data-visual-node]')?.dataset.visualNode;
      const selection = inputControl(focus) ? [focus.selectionStart, focus.selectionEnd, focus.selectionDirection] as const : null;
      if (!previewMode && view.host.hasChildNodes()) reconcileScreen(view.host, content);
      else view.host.replaceChildren(content);
      view.diagnostics.replaceChildren(diagnostics);
      view.status.textContent = shown ? '' : 'Геометрию экрана не удалось рассчитать.';
      if (previewMode) {
        activeScenarios = models.at(-1)?.scenarios??[];
        onDesignChange();
      }
      else {
        design.model = shown ? models[0]??null : null;
        syncSelection();
      }
      if (focusedNode) {
        const control = (previewMode ? view.host.lastElementChild : view.host)
          ?.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(focusedNode)}"] > .visual-surface`);
        if (control && !control.inert && !(('disabled' in control)&&control.disabled)) {
          control.focus({ preventScroll: true });
          if (selection && inputControl(control)) control.setSelectionRange(selection[0],selection[1],selection[2]??undefined);
        } else if (previewMode) closeButton.focus({ preventScroll: true });
      }
      // Existing image nodes retain their loaded asset and do not fetch it again.
      for (const surface of view.host.querySelectorAll<HTMLImageElement>('img[data-asset-id]')) {
        const assetId = surface.dataset.assetId;
        if(!assetId)continue;
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
      if (!current() || aborted(error)) return;
      if (error instanceof ApiError && error.status === 403) { closeInaccessibleDocument(403); return; }
      view.key = null;
      view.captureStamp = null;
      if (!view.host.hasChildNodes()) view.diagnostics.replaceChildren();
      view.status.textContent = `Не удалось показать экран. ${errorMessage(error)}`;
      view.retry.hidden = false;
      if (previewMode) onDesignChange();
    }
  }

  async function replay(next:PreviewTrigger[], matchingScenarios:Scenario[]|null, afterRefresh = false) {
    if (playbackRequest || !isPreview || !context) return;
    const active = playbackRequest = new AbortController();
    const { documentId, revision, screen } = context;
    const size = sizePreview();
    try {
      const body:Schema['PreviewPlaybackRequest'] = {
        revision, triggers: next, selection: {
          screenId: screen.id, variantId: context.variantId, datasetId: null, theme: previewTheme === 'Dark' ? 1 : 0,
          viewport: { width: Math.max(1, size.width), height: Math.max(1, size.height) }
        }
      };
      const result = requiredRecord(await request(`/api/v1/documents/${documentId}/preview`,
        { method: 'POST', body: JSON.stringify(body) }, active.signal));
      if (playbackRequest !== active || active.signal.aborted) return;
      if (result.revision !== revision || result.documentId !== documentId)
        throw new Error('Получен некорректный результат сценария.');
      for (const scenario of matchingScenarios ?? []) {
        for (const action of scenario.actions) {
          if (action.type === 'setDemoValue' && inputValues.delete(action.nodeId)) preview.key = null;
          if (action.type === 'resetPreview') { inputValues.clear(); preview.key = null; }
        }
      }
      triggers = next;
      playback = playbackValue(result.session);
      backButton.disabled = !playback.canGoBack;
      renderActive();
    } catch (error) {
      if (playbackRequest !== active || active.signal.aborted) return;
      if (error instanceof ApiError && error.status === 403) { closeInaccessibleDocument(403); return; }
      if (afterRefresh) {
        triggers = [];
        playback = null;
        backButton.disabled = true;
        renderActive();
      } else preview.status.textContent = `Не удалось выполнить сценарий. ${errorMessage(error)}`;
    } finally {
      if (playbackRequest === active) playbackRequest = null;
    }
  }

  function trigger(nodeId:string, event:number) {
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
    selectTheme('Light');
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
    if (previewTheme === button.dataset.theme) return;
    if(button.dataset.theme==='Light'||button.dataset.theme==='Dark')selectTheme(button.dataset.theme);
    renderActive();
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
    if (triggers.length) replay(triggers.slice(0, -1), null);
  });
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    if (isPreview) resizeTimer = setTimeout(() => {
      if (isPreview && !playbackRequest) renderActive();
    }, 120);
  }).observe(viewport);
  return { get currentTheme() { return isPreview ? previewTheme : "Light"; }, refresh, syncSelection, readDesignModel, setPropertyPreview, clearPropertyPreviews() { propertyPreviews.clear(); }, get designModel() { return !isPreview && design.model?.revision === context?.revision ? design.model : null; } };
}
