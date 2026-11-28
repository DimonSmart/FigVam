import catalog from 'virtual:figvam-lucide';
import type { ColorChannels, DesignToken, GradientStop, LinearGradientValue, NodePropertyValue, Resolution, ResolvableValue, ShadowValue, Theme, TokenMap } from '../core/tokens/token-model';
import { compatibleToken, resolvePropertyToken, resolveTokenValue, tokenColorHex, tokenValueText } from '../core/tokens/token-resolution';
import { createPanelStore } from '../app/panel-store';
import type { ControlDefinition, PropertyModel, RawValue, TokenControlOptions } from './property-control-contract';
import { rawArray, rawText } from './property-control-contract';

const labels:Record<string,string> = {
  editorLocked:'Заблокирован', aspectRatioLocked:'Сохранять пропорции', editorGroup:'Группа',
  x: 'X', y: 'Y', width: 'Ширина', height: 'Высота',
  widthMode: 'Режим ширины', heightMode: 'Режим высоты', visible: 'Видимость', opacity: 'Непрозрачность',
  layout: 'Компоновка', paddingTop: 'Отступ сверху', paddingRight: 'Отступ справа',
  paddingBottom: 'Отступ снизу', paddingLeft: 'Отступ слева', gap: 'Между элементами',
  mainAlignment: 'Выравнивание вдоль оси', crossAlignment: 'Выравнивание поперёк оси',
  overflow: 'Переполнение', text: 'Текст', textColor: 'Цвет текста', textAlignment: 'Выравнивание текста',
  fontSize: 'Размер шрифта', fontFamily: 'Семейство шрифта', fontFallback: 'Запасное семейство шрифта',
  fontWeight: 'Толщина шрифта', fontStyle: 'Начертание', lineHeight: 'Межстрочный интервал',
  letterSpacing: 'Межбуквенный интервал', wrap: 'Перенос строк',
  enabled: 'Доступность', placeholder: 'Подсказка', value: 'Демонстрационное значение', multiline: 'Многострочный режим',
  placeholderColor: 'Цвет подсказки', focusBorderColor: 'Цвет рамки при фокусе', focusBorderWidth: 'Толщина рамки при фокусе',
  inputType: 'Тип ввода', textStyle: 'Стиль текста', borderStyle: 'Стиль рамки',
  typography: 'Типографика', shadow: 'Drop shadow',
  backgroundColor: 'Цвет фона', borderColor: 'Цвет рамки', borderWidth: 'Толщина рамки', cornerRadius: 'Радиус углов',
  rotation: 'Поворот (°)', iconName: 'Иконка Lucide', strokeColor: 'Цвет линии', strokeWidth: 'Толщина линии',
  lineDirection: 'Направление линии', startArrow: 'Начальный наконечник', endArrow: 'Конечный наконечник',
  borderPattern: 'Тип линии', imageClip: 'Форма обрезки', linearGradient: 'Линейный градиент',
  radiusTopLeft: 'Верхний левый радиус', radiusTopRight: 'Верхний правый радиус',
  radiusBottomRight: 'Нижний правый радиус', radiusBottomLeft: 'Нижний левый радиус',
  asset: 'Ассет', altText: 'Альтернативное описание', fit: 'Режим отображения'
};

export const propertyLabel = (name:string) => labels[name] ?? name;
const geometryProperties = new Set(['x', 'y', 'width', 'height']);
const compactGeometryLabel = (name:string) => name === 'width' ? 'W' : name === 'height' ? 'H' : propertyLabel(name);


export type EditKind = 'input' | 'commit' | 'discrete' | 'color-preview';
export interface ValueValidation {value?:ResolvableValue;error?:string;index?:number}
type Choice = readonly [string,string];
interface BaseSpec {
  label:string;
  initial:RawValue;
  count:number;
  validate(raw:RawValue):ValueValidation;
  resolvedRaw?(result:Resolution):RawValue;
}
export interface ScalarSpec extends BaseSpec {
  kind:'scalar'; type:'text'|'textarea'|'number'|'checkbox'|'select'|'catalog'; choices?:Choice[];
  placeholder?:string;required?:boolean;minimum?:number;maximum?:number;maxLength?:number;round?:boolean;
}
export interface ColorSpec extends BaseSpec {kind:'color';compact:boolean}
export interface WeightSpec extends BaseSpec {kind:'weight'}
export interface GradientSpec extends BaseSpec {kind:'gradient';tokens:Choice[]}
export interface ShadowSpec extends BaseSpec {kind:'shadow';color:ValueSpec;nestedColor?:boolean}
export interface TokenScalarSpec extends BaseSpec {kind:'token-scalar';color:boolean;weight:boolean;inputId:string}
export interface CompositeSpec extends BaseSpec {kind:'composite';children:ValueSpec[];id:string}
export interface ReferenceSpec extends BaseSpec {
  kind:'reference';direct:ValueSpec;displayLabel:string;mode:string;theme:Theme;customDirect:boolean;
  getCompatible():DesignToken[];getToken(id:string):DesignToken|undefined;resolve(id:string):Resolution;validateChoices:boolean;
}
export type ValueSpec=ScalarSpec|ColorSpec|WeightSpec|ShadowSpec|TokenScalarSpec|CompositeSpec|ReferenceSpec|GradientSpec;
const invalid=(error:string,index=0):ValueValidation=>({error,index});
const finite=(raw:RawValue|undefined,min=-Infinity,max=Infinity,integer=false):number|null=>{
  if(raw==null||typeof raw==='boolean'||Array.isArray(raw)||!String(raw).trim())return null;
  const n=Number(raw);return Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n))?n:null;
};
const rgb=(c:ColorChannels|null|undefined)=>'#'+[c?.red,c?.green,c?.blue].map(v=>(v??0).toString(16).padStart(2,'0')).join('');
export const weightPresets:Record<string,number>={Normal:400,Medium:500,Semibold:600,Bold:700};
export const gradientPreset:LinearGradientValue={type:'linearGradient',angle:90,stops:[
  {position:0,color:{red:47,green:87,blue:191,alpha:255}},
  {position:1,color:{red:122,green:130,blue:142,alpha:255}}
]};
function gradientSpec(initial:LinearGradientValue,model:PropertyModel):GradientSpec {
  const tokens:Choice[]=[...model.tokens.values()].filter(t=>compatibleToken(t,{type:'Color',tokenType:'Color'})).map(t=>[t.id,t.name]);
  return {kind:'gradient',label:propertyLabel('linearGradient'),count:1,tokens,
    initial:[String(initial.angle),...initial.stops.map(stop=>[String(stop.position),stop.tokenId??'',rgb(stop.color),String(stop.color?.alpha??255)])],
    validate(raw){
      const [a,...rows]=rawArray(raw),angle=finite(a);
      if(angle===null||rows.length<2)return invalid('Укажите угол и минимум две цветовые точки.');
      const stops:GradientStop[]=[];
      for(const row of rows){
        const [p,id,hex,alpha]=rawArray(row),position=finite(p,0,1),tokenId=rawText(id);
        if(position===null)return invalid('Позиция точки должна быть от 0 до 1.');
        if(tokenId){
          if(!tokens.some(([id])=>id===tokenId)||resolveTokenValue({type:'token',tokenId},model.tokens,model.theme??'Light','Color').error)
            return invalid('Выберите действительный цветовой токен.');
          stops.push({position,tokenId});
        }else{
          const result=colorSpec('',null).validate([hex??'',alpha??'']);
          if(result.value?.type!=='color')return invalid(result.error??'Некорректный цвет.');
          const {red,green,blue,alpha:a}=result.value;
          stops.push({position,color:{red,green,blue,alpha:a}});
        }
      }
      return {value:{type:'linearGradient',angle,stops}};
    }
  };
}
export const shadowPreset:ShadowValue={type:'shadow',offsetX:0,offsetY:4,blurRadius:8,spreadRadius:0,color:{red:0,green:0,blue:0,alpha:38}};
export const shadowDimensions=[['offsetX','X',-1024,1024],['offsetY','Y',-1024,1024],['blurRadius','Blur',0,256],['spreadRadius','Spread',-256,256]] as const;

function colorSpec(label:string,initial:ColorChannels|null|undefined,compact=false):ColorSpec {
  return {kind:'color',label,compact,count:compact?4:2,initial:[rgb(initial),String(initial?.alpha??255)],
    validate(raw){
      const [hex,a]=rawArray(raw),alpha=finite(a,0,255,true);
      if(!/^#[0-9a-f]{6}$/i.test(rawText(hex)))return invalid('Введите цвет в формате #RRGGBB.',compact?1:0);
      if(alpha===null)return invalid(compact?'Введите целое значение Alpha от 0 до 255.':'Введите целое значение от 0 до 255.',compact?2:1);
      const [red=0,green=0,blue=0]=[1,3,5].map(i=>parseInt(rawText(hex).slice(i,i+2),16));
      return {value:{type:'color',red,green,blue,alpha}};
    },
    resolvedRaw(result){return result.error||result.value?.type!=='color'?['','255']:[tokenColorHex(result.value),String(result.value.alpha)];}
  };
}
export function createShadowSpec(initial:Pick<ShadowValue,'offsetX'|'offsetY'|'blurRadius'|'spreadRadius'> & {color?:ColorChannels}|null|undefined, colorEditor?:ReferenceSpec):ShadowSpec {
  const value=initial??shadowPreset,color=colorEditor??colorSpec(propertyLabel('shadow'),value.color,true);
  return {kind:'shadow',label:propertyLabel('shadow'),color,nestedColor:!!colorEditor,count:4+color.count,
    initial:[...shadowDimensions.map(([key])=>String(value[key])),...(colorEditor?[color.initial]:rawArray(color.initial))],
    validate(raw){
      const values=rawArray(raw);
      const geometry=shadowDimensions.map(([, ,min,max],i)=>finite(values[i],min,max));
      const bad=geometry.findIndex(v=>v===null);
      if(bad>=0)return invalid('Enter a finite value in the indicated range.',bad);
      const result=color.validate(colorEditor?values[4]??null:values.slice(4));
      if(result.error)return {...result,index:4+(result.index??0)};
      const [offsetX=0,offsetY=0,blurRadius=0,spreadRadius=0]=geometry.map(v=>v??0);
      if(colorEditor&&result.value?.type==='token')return {value:{type:'shadowFields',offsetX,offsetY,blurRadius,spreadRadius,color:{expression:'alias',tokenId:result.value.tokenId}}};
      if(result.value?.type!=='color')return invalid('Некорректный цвет.',4);
      const {type,...channels}=result.value;
      return {value:{type:'shadow',offsetX,offsetY,blurRadius,spreadRadius,color:channels}};
    },
    resolvedRaw(result){
      const v=result.value;
      return result.error||v?.type!=='shadow'?['','','','','','']:
        [...shadowDimensions.map(([key])=>String(v[key])),...(colorEditor?[[colorEditor.mode,colorEditor.direct.resolvedRaw?.({value:{type:'color',...v.color},error:null})??'','']]:[rgb(v.color),String(v.color.alpha)])];
    }
  };
}
function weightSpec(label:string,initial:NodePropertyValue|null|undefined):WeightSpec {
  const mode=initial?.type==='number'?'Custom':initial?.type==='enum'?initial.value:'Normal';
  return {kind:'weight',label,count:2,initial:[mode,initial?.type==='number'?String(initial.value):String(weightPresets[mode]??400)],
    validate(raw){
      const [mode,value]=rawArray(raw);
      if(mode!=='Custom')return {value:{type:'enum',value:rawText(mode)}};
      const n=finite(value,1,1000,true);
      return n===null?invalid('Введите целую толщину шрифта от 1 до 1000.',1):{value:{type:'number',value:n}};
    },
    resolvedRaw(result){return ['Custom',result.error||!result.value||!('value' in result.value)?'':String(result.value.value)];}
  };
}
function scalarSpec(name:string,definition:ControlDefinition,model:PropertyModel,initial:NodePropertyValue|null|undefined,compactGeometry:boolean):ValueSpec {
  const label=propertyLabel(name);
  if(definition.numericFontWeight)return weightSpec(label,initial);
  const type=definition.type,assets=[...model.assets.values()];
  let choices:Choice[]|undefined,placeholder:string|undefined;
  switch(type){
    case 'Asset':choices=assets.map(a=>[a.id,`${a.contentType === 'image/svg+xml' ? 'SVG' : 'PNG'} ${a.width} × ${a.height} · ${a.id}`]);placeholder=assets.length?'Выберите ассет':'В документе нет ассетов';break;
    case 'TokenReference':choices=[...model.tokens.values()].filter(t=>definition.tokenType==null||t.type===definition.tokenType).map(t=>[t.id,t.name]);placeholder=choices.length?'Выберите токен':'Нет доступных токенов';break;
    case 'StyleReference':choices=[...(model.styles?.values()??[])].filter(s=>s.type===definition.styleType).map(s=>[s.id,s.name]);placeholder=choices.length?'Выберите стиль':'Нет стилей данного типа';break;
    case 'Enum':choices=(definition.enumValues??[]).map(v=>[v,v]);break;
  }
  if (name === 'iconName') choices = Object.keys(catalog).sort().map(name => [name, name]);
  const reference=['Asset','TokenReference','StyleReference'].includes(type);
  const raw=initial?.type==='asset'?initial.assetId:initial?.type==='token'?initial.tokenId:initial?.type==='style'?initial.styleId:
    initial&&'value' in initial&&['string','number','boolean'].includes(typeof initial.value)?String(initial.value):'';
  const initialRaw=type==='Boolean'?initial?.type==='boolean'&&initial.value:
    compactGeometry&&raw&&Number.isFinite(Number(raw))?String(Number(Number(raw).toFixed(2))):raw;
  const pattern=definition.pattern?new RegExp(definition.pattern,'u'):null;
  return {kind:'scalar',type:name==='iconName'?'catalog':choices?'select':type==='Number'?'number':type==='Boolean'?'checkbox':type==='String'&&!pattern?'textarea':'text',
    label,count:1,initial:initialRaw,choices,placeholder,required:type==='Number'||Boolean(reference&&definition.required),minimum:definition.minimum??undefined,maximum:definition.maximum??undefined,maxLength:definition.maxLength??undefined,round:compactGeometry,
    validate(raw){
      if(type==='Number'){
        const n=finite(raw,definition.minimum??undefined,definition.maximum??undefined);
        return n===null?invalid(`Введите число от ${definition.minimum??'−∞'} до ${definition.maximum??'∞'}.`):{value:{type:'number',value:compactGeometry?Number(n.toFixed(2)):n}};
      }
      const v=rawText(raw);
      if(type==='String'&&definition.maxLength!=null&&v.length>definition.maxLength)return invalid(`Максимальная длина — ${definition.maxLength}.`);
      if(pattern&&pattern.exec(v)?.[0]!==v)return invalid('Проверьте формат значения.');
      if(choices&&!choices.some(([value])=>value===v)){
        if(reference&&!definition.required&&!v)return {};
        return invalid(placeholder??'Выберите допустимое значение.');
      }
      switch(type){
        case 'Boolean':return{value:{type:'boolean',value:raw===true}};
        case 'String':return{value:{type:'string',value:v}};
        case 'Enum':return{value:{type:'enum',value:v}};
        case 'Asset':return{value:{type:'asset',assetId:v}};
        case 'TokenReference':return{value:{type:'token',tokenId:v}};
        case 'StyleReference':return{value:{type:'style',styleId:v}};
        default:return invalid('Неподдерживаемый тип свойства: '+type);
      }
    },
    resolvedRaw(result){
      if(result.error||!result.value)return '';
      return result.value.type==='geometry'?String(result.value.radius):'value' in result.value?String(result.value.value):'';
    }
  };
}

export function createReferenceSpec(definition:ControlDefinition,model:{tokens:TokenMap},initial:ResolvableValue|null|undefined,direct:ValueSpec,label:string,displayLabel=label,options:TokenControlOptions={}):ReferenceSpec {
  const mode=definition.type.toLowerCase(),theme=options.theme??'Light';
  const resolve=(id:string)=>options.resolve?options.resolve(id):resolvePropertyToken({type:'token',tokenId:id},model.tokens,theme,definition);
  return {kind:'reference',label,displayLabel,direct,mode,theme,count:direct.count+1,customDirect:options.customDirect===true,
    initial:[initial?.type==='token'?'token':mode,direct.initial,initial?.type==='token'?initial.tokenId:''],
    getCompatible:options.getCompatible??(()=>[...model.tokens.values()].filter(t=>compatibleToken(t,definition))),
    getToken:options.getToken??(id=>model.tokens.get(id)),resolve,validateChoices:options.validateChoices===true,
    validate(raw){
      const [source,literal,id]=rawArray(raw);
      if(source!=='token')return direct.validate(literal??null);
      const tokenId=rawText(id),result=resolve(tokenId);
      return result.error?invalid(result.error,direct.count):{value:{type:'token',tokenId}};
    }
  };
}

export function createNodeValueSpec(name:string,definition:ControlDefinition,model:PropertyModel,value:NodePropertyValue|null|undefined,prefix:string):ValueSpec {
  const initial=value??definition.defaultValue;
  if(definition.type==='LinearGradient')return gradientSpec(initial?.type==='linearGradient'?initial:gradientPreset,model);
  const hasTokenChoice=definition.tokenType!=null&&definition.type!=='TokenReference';
  const directValue=hasTokenChoice&&initial?.type==='token'?definition.defaultValue:initial;
  const compactGeometry=prefix==='visual-property'&&geometryProperties.has(name)&&definition.type==='Number';
  const direct=definition.type==='Shadow'?createShadowSpec(directValue?.type==='shadow'?directValue:null):
    definition.type==='Color'?colorSpec(propertyLabel(name),directValue?.type==='color'?directValue:null,hasTokenChoice):
      scalarSpec(name,definition,model,directValue,compactGeometry);
  return hasTokenChoice?createReferenceSpec(definition,model,initial,direct,propertyLabel(name),
    compactGeometry?compactGeometryLabel(name):propertyLabel(name),{theme:model.theme??'Light',customDirect:definition.type==='Shadow'}):direct;
}
export function isGeometryField(name:string,spec:ValueSpec){return geometryProperties.has(name)&&((spec.kind==='scalar'&&spec.round===true)||(spec.kind==='reference'&&spec.direct.kind==='scalar'&&spec.direct.round===true));}
export interface ValueSnapshot {raw:RawValue;disabled:boolean;actionsDisabled:boolean;validation:ValueValidation;version:number}
export function createValueField(spec:ValueSpec,id:string,options:{onEdit?(kind:EditKind):void;disabled?:boolean;validateInitial?:boolean}={}){
  const store=createPanelStore<ValueSnapshot>({raw:spec.initial,disabled:options.disabled??false,actionsDisabled:false,validation:options.validateInitial?spec.validate(spec.initial):{},version:0});
  const read=()=>store.getSnapshot().raw;
  const update=(patch:Partial<ValueSnapshot>)=>{const state=store.getSnapshot();store.publish({...state,...patch});};
  const inputId=(index:number)=>id+(index?'-'+index:'');
  return {spec,id,store,initial:spec.initial,read,
    write(raw:RawValue){if(JSON.stringify(read())===JSON.stringify(raw))return;update({raw,version:store.getSnapshot().version+1});},
    edit(raw:RawValue,kind:EditKind){update({raw});options.onEdit?.(kind);},
    validate(show=true){const result=spec.validate(read());if(show)update({validation:result});return result;},
    setDisabled(disabled:boolean){if(store.getSnapshot().disabled!==disabled)update({disabled});},
    setActionsDisabled(actionsDisabled:boolean){if(store.getSnapshot().actionsDisabled!==actionsDisabled)update({actionsDisabled});},
    refresh(){update({version:store.getSnapshot().version+1});},
    focus(index=0){document.getElementById(inputId(index))?.focus();},
    inputId
  };
}
export type ValueField=ReturnType<typeof createValueField>;
