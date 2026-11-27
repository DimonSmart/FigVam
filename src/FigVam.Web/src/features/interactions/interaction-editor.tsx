import { flushSync } from 'react-dom';
import { createPanelRoot } from '../../app/react-panels';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import type { ApiClient } from '../../api/api-client';
import { requiredRecord, array, text } from '../../api/decode';
import type { Catalog } from './interaction-catalog';

export type ActionKind='navigate'|'openOverlay'|'closeOverlay'|'showVariant'|'setDemoValue'|'selectDataset'|'resetPreview';
export interface ActionDraft {type:ActionKind|'';screenId?:string;variantId?:string|null;datasetId?:string|null;nodeId?:string;value?:string|null}
export interface ScenarioDraft {id:string;screenId:string;nodeId:string;event:number|null;actions:ActionDraft[]}
export interface EditorContext {doc:string|null;screen:string|null;node:string|null;revision:number|null;token:string|null;epoch:number;editable:boolean}
interface Capability {events:number[];actions:string[];potentialActions:string[];demoTargetIds:string[];navigationScreenId:string|null;demoScreenId:string|null}
export interface Draft extends EditorContext {scenario:ScenarioDraft;creating:boolean;opener:HTMLElement|null;original:string;conflict:boolean;valid:boolean;capabilityCache:Map<string,Capability>}
interface EditorOptions {element(id:string):HTMLElement;request:ApiClient;current():EditorContext;catalog():Catalog|null;sourceName(id:string):string;submit(draft:Draft,scenario:ScenarioDraft):void;pending():boolean;onClose():void}
interface Choice {id:string;label:string;group?:string}
interface Values {targetId?:string;screenId?:string|null;variantId?:string|null;datasetId?:string|null;demoNodeId?:string;demoValue?:string|null}
function asElement<T extends HTMLElement>(node:HTMLElement, ctor:{new():T}):T{if(!(node instanceof ctor))throw new Error('Unexpected interaction editor element: '+node.id);return node;}
function number(value:unknown):number{if(typeof value!=='number'||!Number.isInteger(value))throw new TypeError('Invalid event');return value;}
function capability(value:unknown):Capability{const c=requiredRecord(value);return{events:array(c.events,number),actions:array(c.actions,text),potentialActions:array(c.potentialActions,text),demoTargetIds:array(c.demoTargetIds,text),navigationScreenId:c.navigationScreenId==null?null:text(c.navigationScreenId),demoScreenId:c.demoScreenId==null?null:text(c.demoScreenId)};}
export const eventLabels = ['По нажатию', 'При изменении', 'При наведении', 'При уходе указателя', 'При отправке'];
export const actionLabels:Record<ActionKind,string> = {
  navigate: 'Перейти на экран', openOverlay: 'Открыть оверлей', closeOverlay: 'Закрыть оверлей',
  showVariant: 'Переключить вариант', setDemoValue: 'Установить значение',
  selectDataset: 'Выбрать датасет', resetPreview: 'Сбросить Preview'
};
const noValue = '__null__';
const id = (value:unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clone = <T,>(value:T):T => structuredClone(value);
const isActionKind=(value:string):value is ActionKind=>Object.hasOwn(actionLabels,value);
function setChoices(select:HTMLSelectElement, items:Choice[], value:string|null|undefined, placeholder = 'Выберите значение') {
  const options:Choice[] = [{ id: '', label: placeholder }, ...items];
  if (value && !options.some(o => o.id === value)) options.push({ id: value, label: 'Недоступное значение' });
  const key = JSON.stringify(options.map(o => [o.id, o.label, o.group ?? '']));
  if (select.dataset.options !== key) {
    select.replaceChildren();
    const groups = new Map<string,HTMLOptGroupElement>();
    for (const item of options) {
      const option = new Option(item.label, item.id);
      if (!item.group) select.append(option);
      else {
        if (!groups.has(item.group)) {
          const group = document.createElement('optgroup'); group.label = item.group;
          select.append(group); groups.set(item.group, group);
        }
        groups.get(item.group)?.append(option);
      }
    }
    select.dataset.options = key;
  }
  select.value = value ?? '';
}
function ChoiceOptions({items,value,placeholder='Выберите значение'}:{items:Choice[];value:string|null|undefined;placeholder?:string}){
  const options:Choice[]=[{id:'',label:placeholder},...items];
  if(value&&!options.some(o=>o.id===value))options.push({id:value,label:'Недоступное значение'});
  const groups=new Map<string,Choice[]>();
  for(const item of options)if(item.group){const group=groups.get(item.group)??[];group.push(item);groups.set(item.group,group);}
  const rendered=new Set<string>();
  return <>{options.map(item=>{
    if(!item.group)return <option key={item.id} value={item.id}>{item.label}</option>;
    if(rendered.has(item.group))return null;
    rendered.add(item.group);
    return <optgroup key={item.group} label={item.group}>{groups.get(item.group)?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>;
  })}</>;
}
function pickerLabel(type:ActionKind|''){
  switch(type){case 'navigate':case 'openOverlay':return 'Целевой экран';case 'showVariant':return 'Вариант';case 'selectDataset':return 'Датасет';case 'setDemoValue':return 'Целевой элемент';default:return null;}
}
interface RowState {types:Choice[];options:Choice[];error:string;search:string;valueDraft:string}
function actionComplete(a:ActionDraft) {
  switch (a.type) {
    case 'navigate': case 'openOverlay': return id(a.screenId);
    case 'showVariant': return a.variantId === null || id(a.variantId);
    case 'selectDataset': return a.datasetId === null || id(a.datasetId);
    case 'setDemoValue': return id(a.nodeId) && (a.value === null || typeof a.value === 'string' && a.value.length <= 4096);
    case 'closeOverlay': case 'resetPreview': return true;
    default: return false;
  }
}
function emptyAction(type:string):ActionDraft {
  if (type === 'setDemoValue') return { type, value: null };
  return { type:isActionKind(type)?type:'' };
}

export function createInteractionEditor({ element, request, current, catalog, sourceName, submit, pending, onClose }:EditorOptions) {
  let draft:Draft|null=null, rows:RowState[]=[], controller:AbortController|null=null, generation=0, validationTimer:ReturnType<typeof setTimeout>|undefined;
  const listRoot=createPanelRoot(element('scenario-edit-actions'));
  const btn=(id:string)=>asElement(element(id),HTMLButtonElement);
  const form=asElement(element('scenario-edit'),HTMLFormElement),fields=asElement(element('scenario-edit-fields'),HTMLFieldSetElement);
  const event = asElement(element('scenario-edit-event'),HTMLSelectElement), status = element('scenario-edit-validation');
  const sameContext = (d:Draft) => draft === d && current().doc === d.doc && current().screen === d.screen && current().token === d.token;
  const active = (d:Draft) => sameContext(d) && current().revision === d.revision && current().editable && !d.conflict;
  const dirty = () => !!draft && JSON.stringify(draft.scenario) !== draft.original;
  const canSave = () => !!draft && active(draft) && draft.valid && !pending();
  const contextError = 'Документ изменился. Загрузите актуальное состояние или откажитесь от черновика.';

  function refreshControls() {
    if (!draft) return;
    const unavailable = !active(draft) || pending();
    fields.disabled = unavailable;
    btn('scenario-edit-add').disabled = draft.scenario.actions.length >= 32;
    btn('scenario-edit-submit').disabled = !canSave();
    element('scenario-edit-reload').hidden = !draft.conflict;
    element('scenario-edit-conflict').textContent = draft.conflict ? contextError : '';
    btn('scenario-edit-cancel').disabled = pending();
  }

  function close(restoreFocus = false) {
    const old = draft;
    controller?.abort(); clearTimeout(validationTimer); generation++;
    draft = null; rows = [];
    form.hidden = true; fields.disabled = false;
    flushSync(()=>listRoot.render(null));
    onClose();
    if (restoreFocus && old) {
      const target = old.creating ? element('scenario-create') : [...element('scenarios-list').querySelectorAll<HTMLElement>(':scope > *')].find(card => card.dataset.scenarioId === old.scenario.id)?.querySelector<HTMLElement>('button[aria-label^="Изменить"]');
      (target ?? element('tab-prototype')).focus();
    }
  }

  function open(scenario:ScenarioDraft, opener:HTMLElement|null, creating = false) {
    const ctx = current();
    if (!ctx.editable || pending()) return;
    if (draft) close();
    const model = clone(scenario);
    if (creating && !model.actions.length) model.actions.push(emptyAction(''));
    draft = { ...ctx, scenario: model, creating, opener, original: JSON.stringify(model), conflict: false, valid: false, capabilityCache: new Map() };
    form.hidden = false;
    element('scenario-edit-title').textContent = creating ? 'Новое взаимодействие' : 'Редактирование взаимодействия';
    element('scenario-edit-source').textContent = 'Элемент: ' + sourceName(model.nodeId);
    event.replaceChildren();
    delete event.dataset.options;
    renderRows();
    element('scenario-edit-title').focus();
    validate();
  }

  function changed(immediate = false) {
    if (!draft) return;
    draft.valid = false; generation++; controller?.abort();
    clearTimeout(validationTimer); refreshControls();
    status.textContent = 'Проверка взаимодействия…';
    if (immediate) validate();
    else validationTimer = setTimeout(validate, 180);
  }

  function renderRows(focusIndex?:number,reset=true) {
    if(!draft)return;
    const actions=draft.scenario.actions;
    if(reset)rows=actions.map(action=>({types:[],options:[],error:'',search:'',valueDraft:action.value??''}));
    flushSync(()=>listRoot.render(<>{actions.map((action,index)=>{
      const row=rows[index];if(!row)return null;
      const label=pickerLabel(action.type);
      const value=parameter(action)??'';
      const q=row.search.toLocaleLowerCase().trim();
      const options=row.options.filter(o=>!q||o.label.toLocaleLowerCase().includes(q)||o.id===value);
      const move=(direction:number)=>{
        const destination=index+direction,dest=actions[destination];if(!dest)return;
        actions[index]=dest;actions[destination]=action;renderRows(destination);changed(true);
      };
      const set=<K extends keyof ActionDraft>(key:K,next:ActionDraft[K])=>{
        const current=actions[index];if(current){current[key]=next;renderRows(undefined,false);changed();}
      };
      const pick=(next:string)=>{
        switch(action.type){
          case 'navigate':case 'openOverlay':set('screenId',next||undefined);break;
          case 'showVariant':set('variantId',next===noValue?null:next||undefined);break;
          case 'selectDataset':set('datasetId',next===noValue?null:next||undefined);break;
          case 'setDemoValue':set('nodeId',next||undefined);break;
        }
      };
      const secret=catalog()?.nodes.find(n=>n.id===action.nodeId)?.properties?.inputType?.value==='Password';
      return <li className="interaction-action" key={index}>
        <div className="interaction-action-tools"><strong>Действие {index+1}</strong>
          <Button aria-label={'Поднять действие '+(index+1)} disabled={index===0} onClick={()=>move(-1)}>↑</Button>
          <Button aria-label={'Опустить действие '+(index+1)} disabled={index===actions.length-1} onClick={()=>move(1)}>↓</Button>
          <Button aria-label={'Удалить действие '+(index+1)} onClick={()=>{actions.splice(index,1);renderRows(Math.min(index,actions.length-1));changed(true);}}>Удалить</Button>
        </div>
        <label>Тип действия {index+1}<select aria-label={'Тип действия '+(index+1)} data-action-type={index} value={action.type}
          onChange={event=>{actions[index]=emptyAction(event.currentTarget.value);renderRows(index);changed(true);}}>
          <ChoiceOptions items={row.types} value={action.type} placeholder="Выберите действие"/>
        </select></label>
        <div>
          {label&&<>
            <label>Поиск: {label}<TextInput type="search" placeholder="Поиск по имени" aria-label={'Поиск: '+label} value={row.search}
              onChange={event=>{row.search=event.currentTarget.value;renderRows(undefined,false);}}/></label>
            <label>{label}<select aria-label={label} value={value} onChange={event=>pick(event.currentTarget.value)}>
              <ChoiceOptions items={options} value={value}/>
            </select></label>
          </>}
          {action.type==='setDemoValue'&&<>
            <label>Значение null<input type="checkbox" aria-label="Значение null" checked={action.value===null}
              onChange={event=>set('value',event.currentTarget.checked?null:row.valueDraft)}/></label>
            <label>Демонстрационное значение{secret?
              <TextInput type="password" maxLength={4096} value={row.valueDraft} disabled={action.value===null}
                onChange={event=>{row.valueDraft=event.currentTarget.value;set('value',row.valueDraft);}}/>:
              <textarea maxLength={4096} rows={2} value={row.valueDraft} disabled={action.value===null}
                onChange={event=>{row.valueDraft=event.currentTarget.value;set('value',row.valueDraft);}}/>}</label>
          </>}
        </div>
        <p className="interaction-action-error" role="status">{row.error}</p>
      </li>;
    })}</>));
    refreshControls();
    if(focusIndex!==undefined)(element('scenario-edit-actions').querySelector<HTMLElement>('[data-action-type="'+focusIndex+'"]')??element('scenario-edit-add')).focus();
  }

  async function capabilities(d:Draft, prefix:ActionDraft[], values:Values={}):Promise<Capability> {
    const { targetId, screenId, variantId, datasetId, demoNodeId, demoValue = null } = values;
    const q = new URLSearchParams({ revision: String(d.revision), nodeId: d.scenario.nodeId });
    for (const [key, value] of Object.entries({ targetId, screenId, variantId, datasetId, demoNodeId })) if (value) q.set(key, value);
    const body = JSON.stringify({ demoValue, sourceScreenId: d.screen, prefix });
    const cacheKey = q.toString() + '\n' + body;
    // Capability answers are immutable for this draft's document revision.
    // Reusing validated prefixes avoids exhausting the request budget while editing long action lists.
    const cached=d.capabilityCache.get(cacheKey);if(cached)return cached;
    if(!controller||!d.doc)throw new Error('No active scenario request');
    const signal=controller.signal;
    const response = requiredRecord(await request('/api/v1/documents/' + encodeURIComponent(d.doc) + '/scenario-capabilities?' + q, {
      method: 'POST', body
    }, signal));
    if (response.documentId !== d.doc || response.nodeId !== d.scenario.nodeId || response.revision !== d.revision ||
        (response.targetId ?? null) !== (targetId ?? null) || (response.screenId ?? null) !== (screenId ?? null) ||
        (response.variantId ?? null) !== (variantId ?? null) || (response.datasetId ?? null) !== (datasetId ?? null) ||
        (response.demoNodeId ?? null) !== (demoNodeId ?? null) || response.demoValue !== demoValue ||
        !Array.isArray(response.events) || !Array.isArray(response.actions) || !Array.isArray(response.potentialActions) ||
        !Array.isArray(response.demoTargetIds) || !Object.hasOwn(response, 'navigationScreenId') || !Object.hasOwn(response, 'demoScreenId'))
      throw new TypeError('Некорректный ответ о возможностях');
    const decoded=capability(response);
    if (!signal.aborted && active(d)) {
      const oldest=d.capabilityCache.keys().next().value;
      if (d.capabilityCache.size>=256&&oldest!==undefined)d.capabilityCache.delete(oldest);
      d.capabilityCache.set(cacheKey, decoded);
    }
    return decoded;
  }

  function choices(action:ActionDraft, ctx:Capability, objects:Catalog):Choice[] {
    switch (action.type) {
      case 'navigate': case 'openOverlay': return objects.screens.map(s => ({ ...s, group: s.pageName }));
      case 'showVariant': return [{ id: noValue, label: 'Базовое состояние' }, ...objects.variants.filter(v => !ctx.navigationScreenId || v.screenId === ctx.navigationScreenId)];
      case 'selectDataset': return [{ id: noValue, label: 'Без датасета' }, ...objects.datasets];
      case 'setDemoValue': return objects.nodes.filter(n => (!ctx.demoScreenId || n.screenId === ctx.demoScreenId) && ctx.demoTargetIds.includes(n.id));
      default: return [];
    }
  }
  function parameter(action:ActionDraft):string|null|undefined {
    if (action.type === 'navigate' || action.type === 'openOverlay') return action.screenId;
    if (action.type === 'showVariant') return action.variantId === null ? noValue : action.variantId;
    if (action.type === 'selectDataset') return action.datasetId === null ? noValue : action.datasetId;
    if (action.type === 'setDemoValue') return action.nodeId;
    return '';
  }
  function exact(action:ActionDraft, ctx:Capability, objects:Catalog, d:Draft):Values {
    switch (action.type) {
      case 'navigate': case 'openOverlay': return { targetId: action.screenId };
      case 'showVariant': return { screenId: ctx.navigationScreenId ?? objects.variants.find(v => v.id === action.variantId)?.screenId ?? d.screen, variantId: action.variantId };
      case 'selectDataset': return { datasetId: action.datasetId };
      case 'setDemoValue': return { screenId: ctx.demoScreenId ?? objects.nodes.find(n => n.id === action.nodeId)?.screenId, demoNodeId: action.nodeId, demoValue: action.value };
      default: return {};
    }
  }

  async function validate() {
    const d = draft, objects = catalog();
    if (!d || !active(d) || !objects) { refreshControls(); return; }
    controller?.abort(); controller = new AbortController();
    const version = ++generation;
    const live = () => active(d) && version === generation;
    d.valid = false; refreshControls(); status.textContent = 'Проверка взаимодействия…'; element('scenario-edit-recheck').hidden = true;
    try {
      let ctx = await capabilities(d, []);
      if (!live()) return;
      if (d.creating && d.scenario.event === null && ctx.events.length) {
        d.scenario.event = ctx.events.includes(0) ? 0 : ctx.events[0]??null;
        if (JSON.parse(d.original).event === null) {
          const initial = JSON.parse(d.original); initial.event = d.scenario.event; d.original = JSON.stringify(initial);
        }
      }
      setChoices(event, ctx.events.map(v => ({ id: String(v), label: eventLabels[v]??'Неизвестное событие' })), d.scenario.event == null ? '' : String(d.scenario.event), 'Выберите событие');
      let valid = d.scenario.event!==null && ctx.events.includes(d.scenario.event) && d.scenario.actions.length > 0;
      let prefixValid = true;
      for (let i = 0; i < d.scenario.actions.length; i++) {
        const action=d.scenario.actions[i],controls=rows[i];if(!action||!controls)throw new Error('Missing action control');
        if (i > 0 && prefixValid) {
          ctx = await capabilities(d, d.scenario.actions.slice(0, i));
          if (!live()) return;
        }
        controls.types=ctx.potentialActions.filter(isActionKind).map(t=>({id:t,label:actionLabels[t]}));
        const options = prefixValid ? choices(action, ctx, objects) : [];
        controls.options=options;
        controls.error='';
        renderRows(undefined,false);
        let error = '';
        if (!prefixValid) error = 'Сначала исправьте предыдущее действие.';
        else if (!ctx.potentialActions.includes(action.type)) error = action.type ? 'Действие не поддерживается профилем.' : 'Выберите действие.';
        else if (!actionComplete(action)) error = 'Заполните параметры действия.';
        else if (pickerLabel(action.type) && !options.some(o => o.id === parameter(action))) error = 'Цель недоступна в текущем контексте.';
        else {
          const checked = await capabilities(d, d.scenario.actions.slice(0, i), exact(action, ctx, objects, d));
          if (!live()) return;
          if (!checked.actions.includes(action.type)) error = 'Параметры не поддерживаются профилем.';
        }
        if (!error && !ctx.navigationScreenId && action.type === 'showVariant') controls.error = 'Экран определяется состоянием Preview.';
        else if (!error && !ctx.demoScreenId && action.type === 'setDemoValue') controls.error = 'Активный экран определяется состоянием Preview.';
        else controls.error = error;
        renderRows(undefined,false);
        if (error) { valid = false; prefixValid = false; }
      }
      if (!live()) return;
      d.valid = valid && d.scenario.actions.length <= 32;
      status.textContent = d.valid ? '' : 'Заполните событие и исправьте отмеченные действия.';
    } catch (error) {
      if (!live()) return;
      status.textContent = 'Не удалось проверить взаимодействие.';
      element('scenario-edit-recheck').hidden = false;
    } finally { if (live()) refreshControls(); }
  }

  event.addEventListener('change', () => {
    if (!draft) return;
    draft.scenario.event = event.value === '' ? null : Number(event.value);
    changed(true);
  });
  element('scenario-edit-add').addEventListener('click', () => {
    if (!draft || draft.scenario.actions.length >= 32) return;
    draft.scenario.actions.push(emptyAction('')); renderRows(draft.scenario.actions.length - 1); changed(true);
  });
  element('scenario-edit-recheck').addEventListener('click', validate);
  element('scenario-edit-cancel').addEventListener('click', () => close(true));
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  function save() {
    if (!draft||!canSave()) return false;
    submit(draft, clone(draft.scenario));
    return true;
  }
  function revisionChanged() {
    if (!draft) return;
    if ((current().revision !== draft.revision || current().node !== draft.scenario.nodeId) && !pending()) {
      if (!dirty()) { close(); return; }
      draft.conflict = true; draft.valid = false; controller?.abort(); generation++;
    }
    refreshControls();
  }

  return { open, close, save, dirty, canSave, validate, refreshControls, revisionChanged,
    get draft() { return draft; } };
}
