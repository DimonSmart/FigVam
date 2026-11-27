import type { ComponentType } from 'react';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import { createViewModel } from '../../app/view-model';
import { ResourceUsages } from '../../ui/ResourceUsages';
import type { ApiClient } from '../../api/api-client';
import { createDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { toApiNodeProperties } from '../../api/command-value-contracts';
import { requiredRecord, array, text, errorMessage } from '../../api/decode';
import { nodeProperty } from '../../canvas/render-model';
import type { DesignToken, NodePropertyValue, TokenType, TokenCategory, Theme, TokenValue, TypographyFieldsValue, TypographyField } from '../../core/tokens/token-model';

type StyleType='TextStyle'|'BorderStyle';
interface DesignStyle {id:string;name:string;type:number|string;fields:Record<string,NodePropertyValue>;basedOnStyleId:string|null}
interface Usage {label?:string;kind:string;property?:string;theme?:string|number|null;indirect?:boolean;ownerId:string;chain?:string[]}
interface Context {documentId:string|null;documentRole:string|null;revision:number|null;generation:number;navigationEpoch:number}
interface Options {models:ReturnType<typeof createStyleModels>;selectLayer(id:string):void;request:ApiClient;getContext():Context;getTokens():DesignToken[];startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;readPages(signal:AbortSignal):Promise<unknown>}
function style(value:unknown):DesignStyle{const s=requiredRecord(value);return{id:text(s.id),name:text(s.name),type:typeof s.type==='number'?s.type:text(s.type),fields:Object.fromEntries(Object.entries(requiredRecord(s.fields)).map(([name,v])=>[name,nodeProperty(v)])),basedOnStyleId:s.basedOnStyleId==null?null:text(s.basedOnStyleId)};}
function usage(value:unknown):Usage{const v=requiredRecord(value);return{kind:text(v.kind),ownerId:text(v.ownerId),label:v.label==null?undefined:text(v.label),property:v.property==null?undefined:text(v.property),theme:v.theme==null?null:typeof v.theme==='number'?v.theme:text(v.theme),indirect:v.indirect===true,chain:array(v.chain??[],text)};}
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, resolveInlineTypography, tokenValueText } from '../../core/tokens/token-resolution';

const definitions:Record<StyleType,Record<string,[string,TokenType|null,TokenCategory|null]>> = {
  TextStyle: {
    typography: ['Типографика', 'Typography', null],
    textColor: ['Цвет текста', 'Color', null],
    fontStyle: ['Начертание', null, null],
    fontFallback: ['Запасной шрифт', null, null]
  },
  BorderStyle: {
    borderColor: ['Цвет рамки', 'Color', null],
    borderWidth: ['Толщина рамки', 'Dimension', 'BorderWidth'],
    cornerRadius: ['Радиус углов', 'Dimension', 'Radius']
  }
};
const typographyParts:Record<TypographyField,[string,TokenType,TokenCategory|null,string]> = {
  fontFamily: ['Семейство', 'FontFamily', null, 'Arial'],
  fontSize: ['Размер', 'Dimension', 'FontSize', '16'],
  fontWeight: ['Толщина', 'FontWeight', null, '400'],
  lineHeight: ['Интерлиньяж', 'Number', 'LineHeight', '1.25'],
  letterSpacing: ['Межбуквенный интервал', 'Dimension', 'LetterSpacing', '0']
};
const palette:Record<string,string[]> = {
  fontStyle: ['Normal', 'Italic'],
  fontFallback: ['SansSerif', 'Serif', 'Monospace']
};
const styleType = (style:DesignStyle|null|undefined):StyleType => !style || style.type === 0 || style.type === 'TextStyle' ? 'TextStyle' : 'BorderStyle';

function literalOf(field:string, text:string):NodePropertyValue {
  if (field === 'textColor' || field === 'borderColor') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) throw new Error('Введите цвет в формате #RRGGBB или #RRGGBBAA.');
    const hex = text.slice(1) + (text.length === 7 ? 'FF' : '');
    const [red=0, green=0, blue=0, alpha=255] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { type: 'color', red, green, blue, alpha };
  }
  const options=palette[field];
  if (options) {
    if (!options.includes(text)) throw new Error('Выберите допустимое значение.');
    return { type: 'enum', value: text };
  }
  if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Введите число.');
  const number = Number(text);
  if (number < 0 || number > 1000000) throw new Error('Значение вне допустимого диапазона.');
  return { type: 'number', value: number };
}

function literalText(_field:string, value:NodePropertyValue|null|undefined) {
  if (!value) return '';
  if (value.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return String('value' in value?value.value??'':'');
}

type ValueDraft={mode:'literal'|'alias';direct:string;alias:string};
type TypographyDraft=Record<TypographyField,ValueDraft>;
interface FieldDraft extends ValueDraft {field:string;label:string;active:boolean;tokenType:TokenType|null;category:TokenCategory|null;inline:TypographyDraft|null;fallback:string}

interface StyleFieldProps {rows:FieldDraft[];tokens:DesignToken[];updateDraft(part:ValueDraft,key:'mode'|'direct'|'alias',value:string):void;setActive(field:string,active:boolean):void}
function StyleFields({rows,tokens,updateDraft,setActive}:StyleFieldProps){
  function tokenOptions(type:TokenType|null,category:TokenCategory|null,value:string){
    const options=type?tokens.filter(token=>normalizedTokenType(token.type)===type&&normalizedTokenCategory(token.category)===category):[];
    return <><option value="">Выберите токен</option>
      {options.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      {value&&!options.some(item=>item.id===value)&&<option value={value} disabled>Недоступная ссылка</option>}</>;
  }
  function renderTypography(row:FieldDraft,hidden:boolean){
    if(!row.inline)return null;
    const draft=row.inline;
    return <fieldset hidden={hidden}><legend>Поля типографики</legend>
      {(Object.keys(typographyParts) as TypographyField[]).map(field=>{
        const [label,type,category]=typographyParts[field],part=draft[field];
        return <div className="token-typography-row" key={field}>
          <span>{label}</span>
          <select aria-label={label+': источник'} value={part.mode} onChange={event=>updateDraft(part,'mode',event.currentTarget.value)}>
            <option value="literal">Прямое</option><option value="alias">Токен</option>
          </select>
          <TextInput aria-label={label+': значение'} hidden={part.mode==='alias'} value={part.direct} onChange={event=>updateDraft(part,'direct',event.currentTarget.value)}/>
          <select aria-label={label+': токен'} hidden={part.mode!=='alias'} value={part.alias} onChange={event=>updateDraft(part,'alias',event.currentTarget.value)}>
            {tokenOptions(type,category,part.alias)}
          </select>
        </div>;
      })}
    </fieldset>;
  }
  return <>{rows.map(row=>{
      const hidden=!row.active||row.mode==='alias',options=palette[row.field];
      return <div className="style-field-row" key={row.field}>
        <label><input type="checkbox" aria-label={row.label+': переопределить'} checked={row.active}
          onChange={event=>setActive(row.field,event.currentTarget.checked)}/> Задать {row.label}{row.fallback}</label>
        <select aria-label={row.label+': источник'} hidden={!row.active} value={row.mode} onChange={event=>updateDraft(row,'mode',event.currentTarget.value)}>
          <option value="literal">Прямое</option>{row.tokenType&&<option value="alias">Токен</option>}
        </select>
        {row.inline?renderTypography(row,hidden):options?
          <select aria-label={row.label} hidden={hidden} value={row.direct} onChange={event=>updateDraft(row,'direct',event.currentTarget.value)}>
            {options.map(value=><option key={value}>{value}</option>)}
          </select>:<TextInput aria-label={row.label+': значение'} hidden={hidden} value={row.direct}
            onChange={event=>updateDraft(row,'direct',event.currentTarget.value)}/>}
        <select aria-label={row.label+': ссылка на токен'} hidden={!row.active||row.mode!=='alias'} value={row.alias}
          onChange={event=>updateDraft(row,'alias',event.currentTarget.value)}>{tokenOptions(row.tokenType,row.category,row.alias)}</select>
      </div>;
    })}</>;

}
interface StylePanelProps {
  items:DesignStyle[]; selectedId:string|null; name:string; type:StyleType; parentId:string; writable:boolean; busy:boolean;
  preview:string; error:string; status:string; retryVisible:boolean;retry():void; Fields:ComponentType; Usages:ComponentType;
  select(id:string):void; changeName(value:string):void; changeType(value:StyleType):void; changeParent(value:string):void; save():void; remove():void;
}
function StylePanel(p:StylePanelProps) {
  const parents=p.items.filter(item=>styleType(item)===p.type&&item.id!==p.selectedId);
  return <div id="styles-panel">
    <h3>Стили оформления</h3><p id="styles-total" role="status">Стили: {p.items.length}</p>
    <p id="styles-error" role="alert">{p.error}</p><p id="styles-status" role="status" aria-live="polite">{p.status}</p>
    <Button hidden={!p.retryVisible} onClick={p.retry}>Повторить операцию</Button>
    <label htmlFor="styles-list">TextStyle и BorderStyle</label>
    <select id="styles-list" aria-label="Выбрать стиль или создать новый" value={p.selectedId??''} onChange={event=>p.select(event.currentTarget.value)}>
      <option value="">Новый стиль</option>{p.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <form id="styles-form" hidden={!p.writable} onSubmit={event=>{event.preventDefault();p.save();}}>
      <label htmlFor="styles-name">Имя стиля</label><TextInput id="styles-name" maxLength={256} required value={p.name} onChange={event=>p.changeName(event.currentTarget.value)}/>
      <label htmlFor="styles-type">Тип</label><select id="styles-type" disabled={!!p.selectedId} value={p.type} onChange={event=>p.changeType(event.currentTarget.value==='TextStyle'?'TextStyle':'BorderStyle')}>
        <option value="TextStyle">TextStyle</option><option value="BorderStyle">BorderStyle</option>
      </select>
      <label htmlFor="styles-based-on">Основан на (BasedOn)</label>
      <select id="styles-based-on" value={p.parentId} onChange={event=>p.changeParent(event.currentTarget.value)}>
        <option value="">Без родителя</option>{parents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        {p.parentId&&!parents.some(item=>item.id===p.parentId)&&<option value={p.parentId} disabled>Недоступная ссылка</option>}
      </select>
      <div id="styles-fields"><p.Fields/></div><Button id="styles-save" type="submit" disabled={!p.writable||p.busy}>Сохранить стиль</Button>
    </form>
    <Button id="styles-delete" type="button" hidden={!p.writable||!p.selectedId} disabled={p.busy} onClick={p.remove}>Удалить неиспользуемый стиль</Button>
    <pre id="styles-preview" aria-label="Вычисленное оформление Light и Dark">{p.preview}</pre><h4>Использования стиля</h4>
    <ul id="styles-usages" aria-label="Прямые и косвенные использования стиля"><p.Usages/></ul>
  </div>;
}
export function createStyleModels(){return {panel:createViewModel(StylePanel),fields:createViewModel(StyleFields),usage:createViewModel(ResourceUsages)};}

export function createStyles({ models, selectLayer, request, getContext, getTokens, startRequest, stopLive, startLive, readPages }:Options) {
  let items:DesignStyle[]=[], selectedId:string|null=null,busy=false,tokenSignature='';
  const pendingCommands=new Map<string,{operation:DocumentCommandOperation;selection:string|null;running:boolean}>();
  const pending=()=>pendingCommands.get(getContext().documentId??'');
  let draftName='',draftType:StyleType='TextStyle',draftParent='',status='',error='',lastWritable=false;
  let styleUsages:Usage[]=[],styleUsageRequest=0;
  const editable = () => ['Owner', 'Editor'].includes(getContext().documentRole??'');
  const chosen = () => items.find(style => style.id === selectedId);
  const tokens = () => getTokens() ?? [];
  let rows:FieldDraft[]=[];

  function makeTypographyDraft(existing:TokenValue|null|undefined):TypographyDraft {
    const make=(field:TypographyField):ValueDraft=>{
      const fallback=typographyParts[field][3];
      const part=existing?.type==='typographyFields'?existing[field]:null;
      const old=existing?.type==='typography'?existing[field]:null;
      return {mode:part?.expression==='alias'?'alias':'literal',
        direct:part?.expression==='literal'?String('value' in part.value?part.value.value??fallback:fallback):old==null?fallback:String(old),
        alias:part?.expression==='alias'?part.tokenId:''};
    };
    return {fontFamily:make('fontFamily'),fontSize:make('fontSize'),fontWeight:make('fontWeight'),lineHeight:make('lineHeight'),letterSpacing:make('letterSpacing')};
  }
  function typographyValue(draft:TypographyDraft):NodePropertyValue {
    const value:TypographyFieldsValue={type:'typographyFields'};
    for(const field of Object.keys(typographyParts) as TypographyField[]){
      const [,type]=typographyParts[field],part=draft[field];
      if(part.mode==='alias'){
        if(!part.alias)throw new Error('Выберите токен для '+field+'.');
        value[field]={expression:'alias',tokenId:part.alias};
      }else{
        const raw=part.direct.trim();
        let data:TokenValue;
        if(type==='FontFamily'){
          if(!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(raw)||raw.length>128)throw new Error('Некорректное имя шрифта.');
          data={type:'fontFamily',value:raw};
        }else{
          if(!raw||!Number.isFinite(Number(raw)))throw new Error('Недопустимое число для '+field+'.');
          const number=Number(raw);
          if(type==='FontWeight'&&(!Number.isInteger(number)||number<1||number>1000))throw new Error('Недопустимая толщина шрифта.');
          if(field==='letterSpacing'&&Math.abs(number)>100)throw new Error('Межбуквенный интервал должен быть от -100 до 100 px.');
          data={type:type==='Dimension'?'dimension':type==='FontWeight'?'fontWeight':'number',value:number};
        }
        value[field]={expression:'literal',value:data};
      }
    }
    return {type:'typography',value};
  }
  function updateDraft(part:ValueDraft, key:'mode'|'direct'|'alias', value:string) {
    if(key==='mode')part.mode=value==='alias'?'alias':'literal';else part[key]=value;
    renderFields();
  }
  function renderFields(){models.fields.publish({rows,tokens:tokens(),updateDraft,
      setActive:(field,active)=>{const row=rows.find(item=>item.field===field);if(row){row.active=active;renderFields();}}});}
  function buildFields(style:DesignStyle|null|undefined,type:StyleType){
    rows=Object.entries(definitions[type]).map(([field,[label,tokenType,category]])=>{
      const saved=style?.fields?.[field],options=palette[field];
      const direct=options?(saved?.type==='enum'?saved.value:options[0]??''):
        saved&&saved.type!=='token'?literalText(field,saved):field.endsWith('Color')?'#000000FF':field==='cornerRadius'?'6':'1';
      return {field,label,tokenType,category,active:saved!=null,mode:saved?.type==='token'?'alias':'literal',
        direct,alias:saved?.type==='token'?saved.tokenId:'',
        inline:field==='typography'?makeTypographyDraft(saved?.type==='typography'?saved.value:null):null,
        fallback:style?.basedOnStyleId?' (наследуется при отключении)':' (значение по умолчанию)'};
    });
    renderFields();
  }

  function publishPanel() {
    lastWritable=editable();
    models.panel.publish({items,selectedId,name:draftName,type:draftType,parentId:draftParent,writable:lastWritable,busy:busy||!!pending(),retryVisible:lastWritable&&!!pending()&&!pending()?.running,retry:()=>{const op=pending();if(op)void executeStyleCommand(op);},preview:previewText(chosen()),error,status,
      Fields:models.fields.Component,Usages:models.usage.Component,
      select:id=>{selectedId=id||null;void loadUsages();},
      changeName:value=>{draftName=value;publishPanel();},
      changeType:value=>{draftType=value;draftParent='';buildFields(chosen(),value);publishPanel();},
      changeParent:value=>{draftParent=value;publishPanel();},save:saveStyle,remove:deleteStyle});
  }
  function render() {
    const selected = chosen();
    draftType=styleType(selected);draftName=selected?.name??'';draftParent=selected?.basedOnStyleId??'';
    buildFields(selected,draftType);
    publishPanel();
    models.usage.publish({usages:styleUsages,name:id=>items.find(item=>item.id===id)?.name??id,selectLayer});
  }

  function resolvePreview(style:DesignStyle|null|undefined,theme:Theme,seen=new Set<string>()):Record<string,string> {
    if(!style)return {};if(seen.has(style.id))return {error:'Цикл наследования'};seen.add(style.id);
    const result = style.basedOnStyleId ? resolvePreview(items.find(i => i.id === style.basedOnStyleId), theme, seen) : {};
    for (const [field, value] of Object.entries(style.fields ?? {})) {
      if (field === 'typography') {
        const catalog = new Map(tokens().map(item => [item.id, item]));
        const resolved = value?.type === 'token'
          ? resolveTokenValue(value, catalog, theme, 'Typography')
          : resolveInlineTypography(value?.type==='typography'?value.value:null,catalog,theme);
        result.typography = resolved.error ?? tokenValueText(resolved.value);
      } else if (value?.type === 'token') {
        const token = resolveTokenValue(value, new Map(tokens().map(t => [t.id, t])), theme);
        result[field] = token.error ?? tokenValueText(token.value);
      } else result[field] = literalText(field, value);
    }
    return result;
  }

  function previewText(style:DesignStyle|null|undefined) {
    if (!style) return 'Выберите стиль или создайте новый.';
    const summarize = (theme:Theme) => {
      const result = resolvePreview(style, theme);
      return theme + ': ' + Object.entries(result).map(([key, value]) => key + ' = ' + value).join('; ');
    };
    return summarize('Light') + '\n' + summarize('Dark');
  }

  function reset() {
    items = []; selectedId = null; busy = false; tokenSignature = '';
    styleUsages = []; styleUsageRequest++;
    error = ''; status = '';
    render();
  }

  async function read(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean) {
    const all:DesignStyle[]=[];let total:number;
    do {
      const response=requiredRecord(await request(base+'/styles?revision='+revision+'&offset='+all.length+'&limit=100',{},signal,isCurrent));
      if (response.revision !== revision || !Array.isArray(response.items) ||
          typeof response.total!=='number'||!Number.isInteger(response.total) || response.offset !== all.length)
        throw new Error('Некорректный ответ списка стилей.');
      all.push(...response.items.map(style));
      total = response.total;
      if (all.length < total && response.items.length === 0) throw new Error('Неполный список стилей.');
    } while (all.length < total);
    return all;
  }

  function apply(next:DesignStyle[]) {
    const nextTokenSignature = JSON.stringify(tokens().map(token =>
      [token.id, token.name, token.type, token.category]));
    const changed = JSON.stringify(items) !== JSON.stringify(next) ||
      tokenSignature !== nextTokenSignature;
    tokenSignature = nextTokenSignature;
    items = next;
    if (selectedId && !items.some(item => item.id === selectedId)) selectedId = null;
    if (changed || lastWritable !== editable()) render();
    if (changed && selectedId) loadUsages();
  }

  async function write(endpoint:'upsert-style'|'delete-style',payload:{style?:DesignStyle;styleId?:string},id:string|null=selectedId){
    const {documentId,revision}=getContext();
    if(!editable()||busy||pending()||!documentId||revision===null)return;
    try{
      let operation:DocumentCommandOperation;
      if(endpoint==='upsert-style'&&payload.style){
        const {style}=payload;
        operation=createDocumentCommand(documentId,endpoint,{expectedRevision:revision,style:{...style,type:styleType(style)==='TextStyle'?0:1,fields:toApiNodeProperties(style.fields)}});
      }else if(endpoint==='delete-style'&&payload.styleId){
        operation=createDocumentCommand(documentId,endpoint,{expectedRevision:revision,styleId:payload.styleId});
      }else throw new TypeError('Некорректная команда стиля');
      const entry={operation,selection:id,running:false};pendingCommands.set(documentId,entry);await executeStyleCommand(entry);
    }catch(failure){error=errorMessage(failure);publishPanel();}
  }
  async function executeStyleCommand(entry:{operation:DocumentCommandOperation;selection:string|null;running:boolean}){
    const doc=entry.operation.documentId,epoch=getContext().navigationEpoch;
    if(entry.running||!editable()||getContext().documentId!==doc||pendingCommands.get(doc)!==entry)return;
    entry.running=true;busy=true;let generation=getContext().generation;const originSelection=selectedId;stopLive();error='';status='Сохранение…';publishPanel();
    const active=()=>getContext().documentId===doc&&getContext().navigationEpoch===epoch&&pendingCommands.get(doc)===entry;
    try{
      const result=await entry.operation.execute({request,isCurrent:()=>active()&&editable(),
        synchronize:async confirmation=>{
          const {signal,current}=startRequest();generation=current;
          if(selectedId===originSelection)selectedId=entry.selection;
          const refreshed=await readPages(signal);
          return active()&&!signal.aborted&&current===getContext().generation&&refreshed===true&&(getContext().revision??-1)>=confirmation.revision;
        }});
      if(result.kind==='confirmed'&&result.synchronization==='synced'){
        if(active())status='Стиль сохранён.';
        if(pendingCommands.get(doc)===entry)pendingCommands.delete(doc);
      }else if(result.kind==='rejected'||result.kind==='conflict'){
        if(active())error=errorMessage(result.error);
        if(pendingCommands.get(doc)===entry)pendingCommands.delete(doc);
      }else if(active()){status='';error=result.kind==='confirmed'?'Команда подтверждена. Повторите обновление.':'Результат неизвестен. Повторите ту же операцию.';}
    }finally{
      entry.running=false;
      if(getContext().documentId===doc&&getContext().navigationEpoch===epoch){busy=false;render();if(generation===getContext().generation)startLive();}
    }
  }

  async function loadUsages() {
    const id = selectedId, doc = getContext().documentId, revision = getContext().revision;
    const generation = ++styleUsageRequest;
    styleUsages = []; render();
    if (!id || !doc || !Number.isSafeInteger(revision)) return;
    try {
      const found:Usage[]=[];let total:number;
      do {
        const response=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(doc)+'/styles/'+encodeURIComponent(id)+'/usages?revision='+revision+'&offset='+found.length+'&limit=100'));
        if (response.revision !== revision || response.offset !== found.length ||
            !Array.isArray(response.items)||typeof response.total!=='number')throw new Error('Некорректный ответ использований стиля.');
        found.push(...response.items.map(usage)); total = response.total;
        if (found.length < total && response.items.length === 0) throw new Error('Неполный список использований.');
      } while (found.length < total);
      if (generation === styleUsageRequest && id === selectedId &&
          revision === getContext().revision && doc === getContext().documentId) {
        styleUsages = found;
        render();
      }
    } catch (failure) {
      if (generation === styleUsageRequest) { error = errorMessage(failure); publishPanel(); }
    }
  }
  function saveStyle() {
    try {
      const existing = chosen();
      const name = draftName.trim();
      if (!name || name.length > 256) throw new Error('Введите название стиля.');
      const type=draftType;
      const fields:Record<string,NodePropertyValue>={};
      for (const row of rows) {
        if (!row.active) continue;
        const value = row.mode === 'alias'
          ? (row.alias ? { type: 'token' as const, tokenId: row.alias } : null)
          : row.inline ? typographyValue(row.inline) : literalOf(row.field, row.direct);
        if (!value) throw new Error('Выберите токен для ' + row.label);
        fields[row.field] = value;
      }
      const id = existing?.id ?? crypto.randomUUID();
      write('upsert-style', { style: { id, name, type: type === 'TextStyle' ? 0 : 1,
        fields, basedOnStyleId: draftParent || null } }, id);
    } catch (failure) { error = errorMessage(failure); publishPanel(); }
  }
  function deleteStyle() {
    if (selectedId) void write('delete-style', { styleId: selectedId }, null);
  }
  render();
  return { reset, clearCommands:()=>pendingCommands.clear(),discardDocument:(doc:string)=>pendingCommands.delete(doc), read, apply, get items() { return items; } };
}
