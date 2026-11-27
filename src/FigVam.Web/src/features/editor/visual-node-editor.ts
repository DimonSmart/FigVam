import { postDocumentCommand, classifyCommandFailure } from '../../api/document-commands';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, text, aborted, errorMessage } from '../../api/decode';
import type { CanvasNode, CanvasKind, NodeProperties, PropertyDefinitions } from '../../canvas/canvas-model';
import type { NodePropertyValue, ResolvableValue } from '../../core/tokens/token-model';
import type { RawValue, PropertyModel, ControlDefinition } from '../../ui/property-control-contract';

interface Context {documentId:string|null;documentRole:string|null;revision:number|null;screen:string|null;variantId:string|null;selection?:{id:string;name?:string|null;kind:string}|null;navigationEpoch:number;token:string|null}
interface Target extends Context {documentId:string;screen:string;revision:number;nodeId:string}
interface Model extends PropertyModel {nodes:ReadonlyMap<string,CanvasNode>;kinds:ReadonlyMap<string,CanvasKind & {kind:string}>;overridden?:ReadonlyMap<string,ReadonlySet<string>>}
interface Selection {nodeId:string;previousId?:string}
interface Options {models:ReturnType<typeof createPropertyFieldModels>;element(id:string):HTMLElement;request:ApiClient;getContext():Context;readModel():Promise<Model>;refreshDocument(revision:number,isCurrent:()=>boolean,reveal:string[],selection?:Selection,resourcesChanged?:boolean):Promise<boolean>;closeInaccessibleDocument(status:number):void;stopLive():void;startLive():void;previewProperties?(target:Target,properties:NodeProperties):void;onDrawingToolsChanged?(kinds:readonly string[]):void}
interface Draft {values:Map<string,RawValue>;error:string;status:string;coordinateParentId?:string}
interface Palette extends Draft {kind:string;parent:string|null|undefined;selectionId?:string;uploadStatus?:string;uploadError?:string}
interface Field extends ValueField {baseline:RawValue;signature:string;valueSignature?:string;hasValue?:boolean;lastRaw?:RawValue}
interface EditValue {raw:RawValue;value:NodePropertyValue}
interface Automatic {target:Target;fields:Map<string,EditValue>;due:number;rejected:boolean}
type Command='add-node'|'set-node-properties'|'set-screen-variant-properties'|'remove-screen-variant-override'|'remove-node-properties';
interface Body {nodeId:string;parentId?:string;kind?:string;properties?:NodeProperties|string[];expectedParentId?:string;expectedRevision?:number|null;screenId?:string|null;variantId?:string|null;property?:string}
interface Operation {key:string;command:Command;state:'ready'|'pending'|'uncertain';draft:Draft;documentId:string;screen:string;selectionId?:string;body:Body & {commandId:string};auto?:boolean;sent:Map<string,EditValue>;canvas?:boolean;settlePreview?:((confirmed:boolean)=>void)|null}
interface Upload {documentId:string;token:string|null;epoch:number;assetId:string;commandId:string;file:File;draft:Palette;state?:'pending'|'uncertain'}
interface GeometryCommand {nodeId:string;expectedParentId:string;expectedRevision:number;properties:NodeProperties}
function typed<T extends HTMLElement>(node:HTMLElement,ctor:{new():T}):T{if(!(node instanceof ctor))throw new Error('Unexpected inspector element '+node.id);return node;}
function propertyValue(value:ResolvableValue|undefined):NodePropertyValue|undefined{
  if(!value)return undefined;
  switch(value.type){case 'color':case 'shadow':case 'string':case 'enum':case 'boolean':case 'asset':case 'style':case 'token':return value;case 'number':return {type:'number',value:value.value};case 'typography':if('value' in value)return value;}
  return undefined;
}
function definitionValue(value:unknown):unknown{return value&&typeof value==='object'&&'value' in value?value.value:undefined;}
import { createNodeValueSpec, createValueField, propertyLabel, shadowPreset, type ValueField, type EditKind } from '../../ui/property-value';
import { createPropertyFieldModels, type FieldPresentation } from '../../ui/property-layout';

const canEdit = (role:string|null) => role === 'Owner' || role === 'Editor';
const sameRaw = (left:RawValue|undefined, right:RawValue|undefined) => JSON.stringify(left) === JSON.stringify(right);
const draft=():Draft=>({values:new Map<string,RawValue>(),error:'',status:''});
const paletteDraft=():Palette=>({...draft(),kind:'',parent:null});
const scopeKey = (context:Context) => context.documentId && context.screen && Number.isSafeInteger(context.revision) ?
  `${context.documentId}:${context.screen}` : null;

export function createVisualNodeEditor({
  models, element, request, getContext, readModel, refreshDocument, closeInaccessibleDocument, stopLive, startLive, previewProperties = () => {}, onDrawingToolsChanged = () => {}
}:Options) {
  const input=(id:string)=>typed(element(id),HTMLInputElement),button=(id:string)=>typed(element(id),HTMLButtonElement);
  const kindSelect=typed(element('visual-kind'),HTMLSelectElement),parentSelect=typed(element('visual-parent'),HTMLSelectElement);
  const paletteDetails=typed(element('visual-optional-details'),HTMLDetailsElement);
  const inspectorProperties = element('visual-properties');
  const textStyledFields = new Set(['textColor', 'fontFamily', 'fontSize', 'fontWeight',
    'lineHeight', 'letterSpacing', 'fontStyle', 'fontFallback']);
  const borderStyledFields = new Set(['borderColor', 'borderWidth', 'cornerRadius']);
  const operations=new Map<string,Operation>(),paletteDrafts=new Map<string,Palette>(),inspectorDrafts=new Map<string,Draft>(),canvasDrafts=new Map<string,Draft>();
  let context:Context=getContext(),model:Model|null=null,modelKey:string|null=null,resolvedModelKey:string|null=null,modelScope:string|null=null,loadedKey:string|undefined,loadError='',queued=false;
  let palette:Palette|undefined,inspector:Draft|undefined,node:CanvasNode|undefined,paletteFields=new Map<string,Field>(),paletteOptionalFields=new Map<string,Field>(),inspectorFields=new Map<string,Field>();
  let paletteControlKey:string|null=null,inspectorControlKey:string|null|undefined=null;
  let loadingFocus:{id:string;key:string|undefined}|null=null,uploadDocument:string|null|undefined;
  const uploads=new Map<string,Upload>();
  const automatic=new Map<Draft,Automatic>();
  let applyTimer:ReturnType<typeof setTimeout>|undefined;

  // Each entry owns a captured target and validated snapshots, not DOM references.
  // New input remains editable while a previous snapshot awaits acknowledgement.
  function scheduleApply(state:Draft,name:string,field:Field|undefined,immediate=false,previewOnly=false) {
    if(!field||!node)return;
    let entry=automatic.get(state);
    if (!entry) {
      const current = getContext();
      if(!current.documentId||!current.screen||current.revision===null)return;
      entry={target:{...current,documentId:current.documentId,screen:current.screen,revision:current.revision,nodeId:node.id},fields:new Map(),due:0,rejected:false};
      automatic.set(state, entry);
    }
    const result = field.validate(false);
    const value=propertyValue(result.value);
    if(state.values.has(name)&&value!==undefined&&!result.error)entry.fields.set(name,{raw:field.read(),value});
    else entry.fields.delete(name);
    entry.rejected = false;
    previewProperties(entry.target, Object.fromEntries([...entry.fields].map(([key, item]) => [key, item.value])));
    entry.due = previewOnly ? Infinity : Date.now() + (immediate ? 0 : 500);
    planApply();
  }

  function planApply() {
    clearTimeout(applyTimer);
    const current = getContext();
    const ready = [...automatic.entries()].filter(([state, entry]) =>
      entry.fields.size && Number.isFinite(entry.due) && !entry.rejected && entry.target.token === current.token &&
      (entry.target.documentId !== current.documentId || canEdit(current.documentRole)) &&
      ![...operations.values()].some(op => op.documentId === entry.target.documentId));
    if (!ready.length) return;
    applyTimer = setTimeout(pumpApply, Math.max(0, Math.min(...ready.map(([, entry]) => entry.due)) - Date.now()));
  }

  function pumpApply() {
    const current = getContext();
    for (const [state, entry] of automatic) {
      const target = entry.target;
      if (!entry.fields.size || entry.rejected || entry.due > Date.now() || target.token !== current.token ||
          [...operations.values()].some(op => op.documentId === target.documentId)) continue;
      if (current.documentId === target.documentId && !canEdit(current.documentRole)) continue;
      const sent = new Map(entry.fields);
      const properties = Object.fromEntries([...sent].map(([name, item]) => [name, item.value]));
      const expectedRevision = current.documentId === target.documentId && Number.isSafeInteger(current.revision)
        ? current.revision : target.revision;
      const body = target.variantId
        ? { screenId: target.screen, variantId: target.variantId, nodeId: target.nodeId, expectedRevision, properties }
        : { nodeId: target.nodeId, properties, expectedParentId: Object.hasOwn(properties, 'x') || Object.hasOwn(properties, 'y') ? state.coordinateParentId : undefined };
      const key=scopeKey(target);if(!key)continue;
      const op:Operation= { key, command: target.variantId ? 'set-screen-variant-properties' : 'set-node-properties',
        state: 'ready', draft: state, documentId: target.documentId, screen: target.screen,
        selectionId: target.nodeId, body: { commandId: crypto.randomUUID(), ...body }, auto: true, sent };
      operations.set(key, op);
      send(op);
    }
    // A new edit or completed operation will wake blocked entries; do not spin.
  }

  function finishApply(state:Draft|undefined){
    if(!state)return;
    const entry=automatic.get(state);
    if (!entry || entry.rejected) return;
    if (entry.due === Infinity) return;
    entry.due = 0;
    planApply();
  }

  function refresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      context = getContext();
      if (uploadDocument !== context.documentId) {
        input('asset-upload-file').value = '';
        uploadDocument = context.documentId;
      }
      const scope = scopeKey(context);
      const key = scope && `${scope}:${context.revision}:${context.variantId ?? "base"}:${context.navigationEpoch}`;
      const selectionId = context.selection?.id;
      // UI identity follows selection, not the document revision.
      const renderKey = `${scope}:${context.variantId ?? "base"}:${selectionId}:${context.documentRole}:${context.navigationEpoch}`;
      if (modelKey !== key) load(key, scope);
      if (loadedKey !== renderKey) {
        loadedKey = renderKey;
        render();
      } else updateControls();
    });
  }

  function load(key:string|null,scope=scopeKey(context)) {
    modelKey = key;
    loadError = '';
    if (scope !== modelScope) {
      modelScope = scope;
      model = null;
      resolvedModelKey = null;
      paletteFields = new Map(); paletteOptionalFields = new Map(); inspectorFields = new Map();
      paletteControlKey = inspectorControlKey = null;
    }
    if (!key) return;
    // A new pinned snapshot is loaded without blanking the existing inspector.
    readModel().then(result => {
      if (modelKey !== key) return;
      model = result;
      resolvedModelKey = key;
      render();
    }).catch(error => {
      if (modelKey !== key || aborted(error)) return;
      if (error instanceof ApiError && (error.status===403||error.code==='DOCUMENT_NOT_FOUND')) {
        closeInaccessibleDocument(error.status);
        return;
      }
      loadError=errorMessage(error)|| 'Не удалось загрузить профиль и свойства.';
      updateControls();
    });
  }

  function sameChoices(select:HTMLSelectElement,choices:readonly {value:string;text:string}[]) {
    return select.options.length === choices.length &&
      choices.every((choice, index) =>
        select.options[index]?.value === choice.value && select.options[index]?.text === choice.text);
  }

  function render() {
    const focus = document.activeElement?.id;
    if (!model && focus) loadingFocus = { id: focus, key: loadedKey };
    const scope = scopeKey(context), selected = context.selection;
    const editable = canEdit(context.documentRole);
    if (scope && !paletteDrafts.has(scope)) paletteDrafts.set(scope, paletteDraft());
    palette=scope?paletteDrafts.get(scope):undefined;
    node=selected?model?.nodes.get(selected.id):undefined;
    const definition=node?model?.kinds.get(node.kind):undefined;
    const key = node && `${scope}:${context.variantId ?? "base"}:${node.id}`;
    if (key && !inspectorDrafts.has(key)) inspectorDrafts.set(key, draft());
    inspector=key?inspectorDrafts.get(key):undefined;
    element('visual-palette').hidden = !scope || !editable;
    element('visual-inspector').hidden = !scope || !selected;
    element('visual-palette-form').hidden = !model?.kinds.size;
    element('visual-properties-form').hidden = !definition;
    if(model?.kinds.size&&editable&&palette&&context.screen) {
      const kinds = [...model.kinds.keys()];
      const options = kinds.map(kind => ({ value: kind, text: kind }));
      if (!sameChoices(kindSelect, options))
        kindSelect.replaceChildren(...kinds.map(kind => new Option(kind, kind)));
      if (!model.kinds.has(palette.kind)) palette.kind=kinds[0]??'';
      kindSelect.value = palette.kind;
      const choices = [{ value: context.screen, text: 'Выбранный экран' }];
      if (selected && node)
        choices.push({ value: selected.id, text: `Выбранный слой · ${selected.name?.trim() || selected.kind}` });
      if (!sameChoices(parentSelect, choices))
        parentSelect.replaceChildren(...choices.map(option => new Option(option.text, option.value)));
      if (palette.selectionId !== selected?.id) {
        palette.selectionId = selected?.id;
        palette.parent = selected?.id;
      }
      parentSelect.value = node && palette.parent === node.id ? node.id : context.screen;
      renderRequiredFields();
    }
    if (inspectorControlKey !== key) {
      inspectorFields = new Map();
      inspectorControlKey = key;
    }
    inspectorFields = renderFields(models.inspector, definition?.properties, node?.properties,
      editable ? inspector : undefined, 'visual-property', inspectorFields);
    updateControls();
    const focusId = focus || (loadingFocus && loadingFocus.key === loadedKey ? loadingFocus.id : null);
    if(focusId)requestAnimationFrame(()=>{const nextFocus=document.getElementById(focusId);if(document.activeElement===document.body&&nextFocus&&!nextFocus.closest('[hidden]')&&!('disabled' in nextFocus&&nextFocus.disabled))nextFocus.focus({preventScroll:true});});
    if (model) loadingFocus = null;
  }

  function renderRequiredFields(){
    if(!palette||!model)return;
    const key = `${scopeKey(context)}:${palette.kind}`;
    if (paletteControlKey !== key) {
      paletteFields = new Map();
      paletteOptionalFields = new Map();
      paletteDetails.open = false;
      paletteControlKey = key;
    }
    const properties = model?.kinds.get(palette.kind)?.properties ?? {};
    const required = Object.fromEntries(Object.entries(properties).filter(([, definition]) => definition?.required));
    paletteFields = renderFields(models.required, required, null, palette, 'visual-required', paletteFields);
    const optional = Object.fromEntries(Object.entries(properties)
      .filter(([, definition]) => definition && !definition.required && definition.tokenType != null &&
        (definition.type === 'Color' || definition.type === 'Number' ||
          definition.type === 'String' || definition.type === 'Enum')));
    paletteDetails.hidden = !Object.keys(optional).length;
    paletteOptionalFields = renderFields(models.optional, optional, null, palette,
      'visual-optional', paletteOptionalFields);
    if ([...paletteOptionalFields.keys()].some(name => palette?.values.has(name)))
      paletteDetails.open = true;
  }

  function renderFields(view:ReturnType<typeof createPropertyFieldModels>['inspector'],definitions:PropertyDefinitions|undefined,values:NodeProperties|null|undefined,state:Draft|undefined,prefix:string,existing=new Map<string,Field>()):Map<string,Field>{
    const fields=new Map<string,Field>(),entries:FieldPresentation[]=[];
    for(const [name,definition] of Object.entries(definitions??{})){
      if(!model||!definition||!definition.type)continue;
      const controlDefinition:ControlDefinition={...definition,type:definition.type};
      const choices=definition.type==='Asset'?[...model.assets.values()]:definition.type==='TokenReference'||definition.tokenType!=null?[...model.tokens.values()]:null;
      const signature=JSON.stringify([definition,choices,Boolean(state)]);
      const valueSignature=JSON.stringify(values?.[name]??definition.defaultValue);
      const previous=existing.get(name);
      let field:Field;
      if(!previous||previous.signature!==signature){
        const spec=createNodeValueSpec(name,controlDefinition,model,values?.[name],prefix);
        field={...createValueField(spec,prefix+'-'+name,{onEdit:update,validateInitial:values?.[name]?.type==='token'}),baseline:spec.initial,signature,valueSignature};
        function update(kind:EditKind){
          if(!state)return;
          const raw = field.read();
          const automaticField = prefix === 'visual-property';
          const discrete = kind === 'discrete' || kind === 'commit';
          // Browsers emit both input and change, including a delayed change on blur.
          // A no-op must not clear the last acknowledgement or requeue saved values.
          if (automaticField && sameRaw(field.lastRaw, raw)) {
            const entry=automatic.get(state);
            if(discrete&&entry?.fields.has(name)){
              entry.due=0;planApply();
            }
            return;
          }
          field.lastRaw = raw;
          const inFlight = [...operations.values()].find(op => op.auto && op.draft === state)?.sent.has(name);
          if (sameRaw(field.baseline, raw) && !inFlight && !(name === 'shadow' && !field.hasValue && state.values.has(name))) state.values.delete(name);
          else state.values.set(name, raw);
          if (state === inspector && (name === 'x' || name === 'y')) {
            if (state.values.has('x') || state.values.has('y')) state.coordinateParentId??=node?.parentId;
            else state.coordinateParentId = undefined;
          }
          state.error = state.status = '';
          field.validate();
          if (automaticField) {
            // A native color picker may emit many input events before its change event.
            if (kind === 'color-preview') {
              scheduleApply(state, name, field, false, true); updateControls(); return;
            }
            scheduleApply(state, name, field, discrete);
          }
          updateControls();
        }

      }else{
        field=previous;
        if(field.valueSignature!==valueSignature){
          field.baseline=createNodeValueSpec(name,controlDefinition,model,values?.[name],prefix).initial;
          field.valueSignature=valueSignature;
        }
      }
      field.hasValue=values?.[name]!==undefined;
      if(state?.values.has(name)){
        const raw=state.values.get(name);if(!sameRaw(field.read(),raw))field.write(raw??null);field.validate();
      }else if(!sameRaw(field.read(),field.baseline)){field.write(field.baseline);field.validate();}
      field.lastRaw=field.read();
      const entry:FieldPresentation={name,field};
      if(state&&prefix==='visual-property'){
        entry.onLeave=()=>finishApply(state);
        entry.onKey=event=>{
          if(event.nativeEvent.isComposing||!(event.target instanceof Element))return;
          if(event.key==='Enter'&&event.target.matches('input:not([type=search])')){event.preventDefault();finishApply(state);}
          if(event.key==='Escape'&&event.target.matches('input, textarea')&&!event.target.closest('.token-value-popover')){
            const op=[...operations.values()].find(item=>item.auto&&item.draft===state);
            if(op?.sent.has(name))return;
            state.values.delete(name);automatic.get(state)?.fields.delete(name);
            const pending=automatic.get(state);if(pending)previewProperties(pending.target,Object.fromEntries([...pending.fields].map(([key,item])=>[key,item.value])));
            field.write(field.baseline);field.lastRaw=field.read();field.validate();state.error='';updateControls();planApply();
          }
        };
      }
      if(prefix==='visual-property'){
        const overridden=Boolean(context.variantId&&model?.overridden?.get(node?.id??'')?.has(name));
        entry.variantOverride=overridden;
        const hasStyle=textStyledFields.has(name)?node?.properties.textStyle?.type==='style'||node?.properties.typography?.type==='token'&&name!=='textColor':
          borderStyledFields.has(name)&&node?.properties.borderStyle?.type==='style';
        const localOverride=!context.variantId&&hasStyle&&node?.properties[name]!==undefined;
        entry.styleOverride=Boolean(localOverride);
        if(localOverride&&state)entry.resetStyle=()=>{
          const current=getContext();if(current.variantId||!node||!canEdit(current.documentRole))return;
          begin('remove-node-properties',{nodeId:node.id,properties:[name],expectedRevision:current.revision},inspector);
        };
        if(overridden&&state)entry.resetVariant=()=>{
          const current=getContext();if(!current.variantId||!node||!canEdit(current.documentRole))return;
          begin('remove-screen-variant-override',{screenId:current.screen,variantId:current.variantId,nodeId:node.id,property:name,expectedRevision:current.revision},inspector);
        };
        if(name==='shadow'){
          const active=values?.shadow!==undefined||Boolean(state?.values.has(name));
          const inherited=active&&context.variantId&&values?.shadow!==undefined&&!overridden&&!state?.values.has(name);
          entry.shadow={active,toggle:!state||inherited?undefined:()=>{
            const current=getContext();
            if(!node||!model||!canEdit(current.documentRole)||operations.has(scopeKey(current)??'')||resolvedModelKey!==modelKey)return;
            if(!active){
              const preset=createNodeValueSpec(name,controlDefinition,model,shadowPreset,prefix).initial;
              state.values.set(name,preset);render();scheduleApply(state,name,inspectorFields.get(name),true);
            }else if(current.variantId){
              if(model?.overridden?.get(node?.id??'')?.has(name))begin('remove-screen-variant-override',{screenId:current.screen,variantId:current.variantId,nodeId:node.id,property:name,expectedRevision:current.revision},state);
              else if(state.values.has(name)){state.values.delete(name);render();}
            }else if(values?.shadow!==undefined)begin('remove-node-properties',{nodeId:node.id,properties:[name],expectedRevision:current.revision},state);
            else{state.values.delete(name);render();}
          }};
        }
      }
      fields.set(name,field);entries.push(entry);
    }
    view.publish({entries,inspector:prefix==='visual-property'});
    return fields;
  }

  function eligibleParent() {
    const id = parentSelect.value;
    return id === context.screen || model?.kinds.get(model.nodes.get(id)?.kind??'')?.canContainChildren === true;
  }

  function updateControls() {
    if (!context) return;
    const op = operations.get(scopeKey(context)??'');
    const adding = op?.command === 'add-node',
      editing = ['set-node-properties', 'set-screen-variant-properties', 'remove-screen-variant-override', 'remove-node-properties'].includes(op?.command??'') && !op?.canvas;
    const canvas = canvasDrafts.get(scopeKey(context)??'');
    const editable = canEdit(context.documentRole);
    // An old inspector snapshot is visible while synchronizing, but it must not submit stale edits.
    const blocked = !editable || Boolean(op) || Boolean(modelKey && resolvedModelKey !== modelKey);
    const upload = uploads.get(context.documentId??'');
    const uploading = upload?.state === 'pending';
    input('asset-upload-file').disabled = !editable || Boolean(upload);
    button('asset-upload').disabled = !editable || Boolean(upload);
    element('asset-upload-retry').hidden = !editable || upload?.state !== 'uncertain';
    element('asset-upload-status').textContent = uploading ? 'Загрузка изображения…' :
      upload?.state === 'uncertain' ? 'Подтверждение не получено. Повторите загрузку.' : palette?.uploadStatus || '';
    element('asset-upload-error').textContent = palette?.uploadError || '';
    kindSelect.disabled = parentSelect.disabled = blocked;
    for (const field of paletteFields.values()) field.setDisabled(blocked);
    for (const field of paletteOptionalFields.values()) field.setDisabled(blocked);
    for (const [name, field] of inspectorFields) field.setDisabled(!editable || Boolean(op && !op.canvas && !op.auto));
    for(const field of inspectorFields.values())field.setActionsDisabled(blocked);
    const validParent = model?.kinds.size && eligibleParent();
    const requiredReady = [...paletteFields.values()].every(field => field.validate(false).value !== undefined);
    const optionalReady = [...paletteOptionalFields].every(([name, field]) =>
      !palette?.values.has(name) || field.validate(false).value !== undefined);
    button('visual-add').disabled = blocked || !validParent || !requiredReady || !optionalReady;
    const autoEntry = (inspector?automatic.get(inspector):undefined);
    element('visual-properties-reset').hidden = !editable || !inspector?.values.size;
    button('visual-properties-reset').disabled = blocked;
    element('visual-add-retry').hidden = !editable || !adding || op.state !== 'uncertain';
    element('visual-save-retry').hidden = !editable || !(editing && op?.state==='uncertain' || autoEntry?.rejected && autoEntry.fields.size);
    element('visual-palette-retry').hidden = element('visual-data-retry').hidden = !loadError;
    element('visual-palette-error').textContent = loadError || palette?.error || '';
    element('visual-inspector-error').textContent = loadError || inspector?.error || '';
    element('canvas-edit-error').textContent = canvas?.error || '';
    element('canvas-edit-status').textContent = op?.canvas ?
      operationStatus(op, 'Сохранение геометрии…') : canvas?.status || '';
    element('canvas-edit-retry').hidden = !editable || !op?.canvas || op.state !== 'uncertain';
    const defaults = model?.kinds.get(palette?.kind??'')?.properties;
    const geometry = ['width', 'height', 'x', 'y'].map(name => definitionValue(defaults?.[name]?.defaultValue));
    const geometryHint = geometry.every(Number.isFinite) ?
      `Размер ${geometry[0]} × ${geometry[1]}, положение X ${geometry[2]}, Y ${geometry[3]}.` : '';
    const loading = scopeKey(context) && !model && !loadError ? 'Загрузка профиля…' : '';
    const paletteStatus = !validParent && model?.kinds.size ?
      'Выбранный слой не допускает дочерние элементы. Укажите экран или выберите контейнер.' :
      model && !model.kinds.size ? 'Профиль документа не содержит визуальных видов.' : geometryHint;
    element('visual-palette-status').textContent = adding ?
      operationStatus(op, 'Добавление элемента…') : loading || [palette?.status, paletteStatus].filter(Boolean).join(' ');
    element('visual-inspector-status').textContent = editing ?
      operationStatus(op,'Сохранение свойств…') : loading || (autoEntry?.fields.size && !autoEntry.rejected ? 'Сохранение свойств…' : inspector?.status || '');
    onDrawingToolsChanged(!element('visual-palette').hidden && !element('visual-palette-form').hidden && !kindSelect.disabled
      ? [...kindSelect.options].map(option => option.value) : []);
  }

  function operationStatus(op:Operation|undefined,pending:string) {
    return op?.state === 'uncertain' ? 'Подтверждение не получено. Повторите ту же команду.' : pending;
  }

  function readProperties(fields:ReadonlyMap<string,Field>,names:Iterable<string>):NodeProperties|null{
    const properties:NodeProperties={};let invalid:{field:Field;index:number}|undefined;let failed=false;
    for (const name of names) {
      const field=fields.get(name);if(!field){failed=true;continue;}
      const {value,index,error}=field.validate();const parsed=propertyValue(value);
      if(error){invalid??={field,index:index??0};failed=true;}
      else if(parsed!==undefined)properties[name]=parsed;
    }
    if(invalid){const target=invalid;requestAnimationFrame(()=>target.field.focus(target.index));}
    return failed?null:properties;
  }

  element('asset-upload-file').addEventListener('change', () => {
    if (palette) palette.uploadError = palette.uploadStatus = '';
    updateControls();
  });
  element('asset-upload-form').addEventListener('submit', event => {
    event.preventDefault();
    const current = getContext(), file=input('asset-upload-file').files?.[0];
    const scope = scopeKey(current);
    if(!file||!scope||!current.documentId||!canEdit(current.documentRole)||uploads.has(current.documentId)) return;
    // Uploads may start before the async palette render finishes. Bind the
    // operation to its scoped draft rather than the potentially unset UI field.
    if (!paletteDrafts.has(scope))
      paletteDrafts.set(scope, paletteDraft());
    const currentDraft=paletteDrafts.get(scope);if(!currentDraft)return;
    const op:Upload={documentId:current.documentId,token:current.token,epoch:current.navigationEpoch,assetId:crypto.randomUUID(),commandId:crypto.randomUUID(),file,draft:currentDraft};
    uploads.set(op.documentId, op);
    sendUpload(op);
  });
  element('asset-upload-retry').addEventListener('click', () => {
    const op = uploads.get(getContext().documentId??'');
    if (op?.state === 'uncertain' && canEdit(getContext().documentRole)) sendUpload(op);
  });

  async function sendUpload(op:Upload) {
    const view = getContext();
    op.token = view.token; op.epoch = view.navigationEpoch;
    const current = () => uploads.get(op.documentId) === op && getContext().documentId === op.documentId &&
      getContext().token === op.token && getContext().navigationEpoch === op.epoch;
    op.state = 'pending'; op.draft.uploadError = op.draft.uploadStatus = '';
    updateControls();
    stopLive();
    try {
      const result=requiredRecord(await request(`/api/v1/documents/${encodeURIComponent(op.documentId)}/assets/${op.assetId}?commandId=${op.commandId}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:op.file},undefined,current));
      if (!current() || result.status !== 'ACCEPTED' || result.commandId !== op.commandId ||
        text(result.documentId).toLowerCase() !== op.documentId.toLowerCase() || typeof result.revision!=='number'||!Number.isSafeInteger(result.revision) ||
        !await refreshDocument(result.revision, current, [], undefined, true)) {
        op.state = 'uncertain';
        return;
      }
      uploads.delete(op.documentId);
      input('asset-upload-file').value = '';
      op.draft.uploadStatus = 'Изображение загружено. Выберите его в поле «Ассет».';
    } catch (error) {
      if(classifyCommandFailure(error,current())==='uncertain') op.state = 'uncertain';
      else {
        uploads.delete(op.documentId);
        if (error.code === 'DOCUMENT_NOT_FOUND') { closeInaccessibleDocument(error.status); return; }
        op.draft.uploadError = error.code === 'ASSET_LIMIT_EXCEEDED' ? 'Достигнут лимит ассетов документа.' :
          error.status === 413 ? 'Файл превышает 5 МиБ.' :
          error.status === 400 || error.status === 415 ? 'Сервер отклонил изображение. Выберите допустимый PNG.' : error.message;
      }
    } finally { startLive(); refresh(); }
  }

  function changeKind() {
    if(!palette||palette.kind===kindSelect.value) return;
    palette.kind = kindSelect.value;
    palette.values.clear();
    palette.error = palette.status = '';
    renderRequiredFields();
    updateControls();
  }
  kindSelect.addEventListener('change', changeKind);
  function changeParent() {
    if(!palette)return;palette.parent=parentSelect.value;
    palette.error = palette.status = '';
    updateControls();
  }
  parentSelect.addEventListener('change', changeParent);
  function submitPalette() {
    const kind = model?.kinds.get(kindSelect.value);
    if(!palette||!kind||!eligibleParent() || !canEdit(getContext().documentRole)) return;
    const properties = readProperties(paletteFields, paletteFields.keys());
    if (!properties) return;
    const optionalNames = [...palette.values.keys()].filter(name => paletteOptionalFields.has(name));
    const selected = readProperties(paletteOptionalFields, optionalNames);
    if (!selected) return;
    begin('add-node', {
      nodeId: crypto.randomUUID(), parentId: parentSelect.value, kind: kind.kind,
      properties: { ...properties, ...selected }
    }, palette);
  }
  element('visual-palette-form').addEventListener('submit', event => {
    event.preventDefault();
    submitPalette();
  });
  function addFromToolbar(kind: string): boolean {
    if (kindSelect.disabled || element('visual-palette').hidden || element('visual-palette-form').hidden ||
        ![...kindSelect.options].some(option => option.value === kind)) return true;
    kindSelect.value = kind;
    changeKind();
    if (button('visual-add').disabled && parentSelect.options.length) {
      parentSelect.selectedIndex = 0;
      changeParent();
    }
    if (button('visual-add').disabled) return false;
    submitPalette();
    return true;
  }
  element('visual-properties-form').addEventListener('submit', event => {
    event.preventDefault();
    finishApply(inspector);
  });
  element('visual-properties-reset').addEventListener('click', () => {
    if (!inspector || operations.has(scopeKey(getContext())??'') || !canEdit(getContext().documentRole)) return;
    const entry = (inspector?automatic.get(inspector):undefined);
    if (entry) previewProperties(entry.target, {});
    automatic.delete(inspector);
    inspector.values.clear();
    inspector.coordinateParentId = undefined;
    inspector.error = inspector.status = '';
    render();
    inspectorProperties.querySelector<HTMLElement>('input, select, textarea')?.focus();
  });
  for (const id of ['visual-palette-retry', 'visual-data-retry'])
    element(id).addEventListener('click', () => { load(modelKey); updateControls(); });
  for (const id of ['visual-add-retry', 'visual-save-retry', 'canvas-edit-retry'])
    element(id).addEventListener('click', () => {
      const op = operations.get(scopeKey(getContext())??'');
      if (op?.state === 'uncertain' && canEdit(getContext().documentRole)) send(op);
      else if(id==='visual-save-retry'&&inspector){const entry=automatic.get(inspector);if(entry?.rejected){entry.rejected=false;finishApply(inspector);}}
    });

  function begin(command:Command,body:Body,state:Draft|undefined,canvas:((confirmed:boolean)=>void)|null=null) {
    const current = getContext(), key = scopeKey(current);
    if(!state||!key||!current.documentId||!current.screen||scopeKey(context)!==key || context.revision !== current.revision ||
      context.selection?.id !== current.selection?.id || operations.has(key) ||
      resolvedModelKey !== modelKey) return false;
    const op:Operation={key,command,state:'ready',draft:state,documentId:current.documentId,screen:current.screen,sent:new Map(),
      selectionId: current.selection?.id, body: { commandId: crypto.randomUUID(), ...body },
      canvas: Boolean(canvas), settlePreview: canvas };
    operations.set(key, op);
    send(op);
    return true;
  }

  async function send(op:Operation) {
    const { token, navigationEpoch } = getContext(), adding = op.command === 'add-node';
    const current = () => {
      const view = getContext();
      return operations.get(op.key) === op && view.token === token &&
        (op.auto || scopeKey(view) === op.key && view.navigationEpoch === navigationEpoch);
    };
    op.state = 'pending';
    op.draft.error = op.draft.status = '';
    updateControls();
    if (getContext().documentId === op.documentId) stopLive();
    let confirmed = false;
    try {
      const result=requiredRecord(await postDocumentCommand(request,op.documentId,op.command,op.body,undefined,current));
      if (!current() || result.status !== 'ACCEPTED' || text(result.documentId).toLowerCase() !== op.documentId.toLowerCase() ||
        result.commandId !== op.body.commandId || result.nodeId !== op.body.nodeId || typeof result.revision!=='number'||!Number.isSafeInteger(result.revision)) {
        op.state = 'uncertain';
        return;
      }
      const reveal=adding&&op.body.parentId&&op.body.parentId!==op.screen?[op.body.parentId]:[];
      const selection = adding ? { nodeId: op.body.nodeId, previousId: op.selectionId } : undefined;
      const view = getContext();
      const activeDocument = view.documentId === op.documentId && canEdit(view.documentRole);
      const activeSync = () => current() && getContext().documentId === op.documentId && getContext().navigationEpoch === view.navigationEpoch;
      const synced = !op.auto || activeDocument ? await refreshDocument(result.revision, op.auto ? activeSync : current, reveal, selection) : true;
      if (!synced && !op.auto) {
        op.state = 'uncertain';
        return;
      }
      operations.delete(op.key);
      confirmed = true;
      if (op.command === 'remove-node-properties' || op.command === 'remove-screen-variant-override') {
        const removed=Array.isArray(op.body.properties)?op.body.properties:op.body.property?[op.body.property]:[];
        for(const property of removed)op.draft.values.delete(property);
      } else if (op.auto) {
        const entry = automatic.get(op.draft);
        for (const [name, item] of op.sent) {
          if (sameRaw(op.draft.values.get(name), item.raw)) op.draft.values.delete(name);
          if (entry && sameRaw(entry.fields.get(name)?.raw, item.raw)) entry.fields.delete(name);
        }
        if (!op.draft.values.has('x') && !op.draft.values.has('y')) op.draft.coordinateParentId = undefined;
        if (entry) {
          previewProperties(entry.target, Object.fromEntries([...entry.fields].map(([key, item]) => [key, item.value])));
          entry.target.revision = result.revision;
        }
        if (!op.draft.values.size) automatic.delete(op.draft);
      } else {
        op.draft.values.clear();
        op.draft.coordinateParentId = undefined;
      }
      op.draft.status = adding ? 'Элемент добавлен.' : op.canvas ? 'Геометрия сохранена.' : 'Свойства сохранены.';
      if (scopeKey(getContext()) === op.key && (!op.auto || resolvedModelKey === modelKey)) render();
    } catch (error) {
      if(classifyCommandFailure(error,current())==='uncertain') op.state = 'uncertain';
      else {
        operations.delete(op.key);
        if (error.code === 'DOCUMENT_NOT_FOUND') {
          closeInaccessibleDocument(error.status);
          return;
        }
        const property = error.property ? `${propertyLabel(error.property)} · ` : '';
        op.draft.error = property + (error.detail || error.message);
        if (op.auto && automatic.has(op.draft)) {
          const entry=automatic.get(op.draft);if(entry){entry.rejected=true;previewProperties(entry.target,{});}
        }
      }
    } finally {
      op.settlePreview?.(confirmed);
      op.settlePreview = null;
      startLive();
      refresh();
      planApply();
    }
  }

  function editGeometry(body:GeometryCommand,settlePreview:(confirmed:boolean)=>void) {
    const current = getContext(), key = scopeKey(current);
    if (!key || !canEdit(current.documentRole) || current.revision !== body.expectedRevision ||
      current.selection?.id !== body.nodeId || operations.has(key)) return false;
    if (!canvasDrafts.has(key)) canvasDrafts.set(key, draft());
    return begin(current.variantId ? 'set-screen-variant-properties' : 'set-node-properties',
      current.variantId ? {
        screenId: current.screen, variantId: current.variantId,
        nodeId: body.nodeId, properties: body.properties, expectedRevision: body.expectedRevision
      } : body,
      canvasDrafts.get(key), settlePreview);
  }

  return {
    refresh, editGeometry, addFromToolbar,
    get editPending() { return operations.has(scopeKey(getContext())??''); },
    clear() { clearTimeout(applyTimer); automatic.clear(); operations.clear(); uploads.clear(); paletteDrafts.clear(); inspectorDrafts.clear(); canvasDrafts.clear(); }
  };
}
