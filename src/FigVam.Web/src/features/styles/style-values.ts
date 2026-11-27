import type { NodePropertyValue, TokenType, TokenCategory, TokenValue, TypographyFieldsValue, TypographyField } from '../../core/tokens/token-model';
export type StyleType='TextStyle'|'BorderStyle';
export interface DesignStyle {id:string;name:string;type:number|string;fields:Record<string,NodePropertyValue>;basedOnStyleId:string|null}
export const definitions:Record<StyleType,Record<string,[string,TokenType|null,TokenCategory|null]>> = {
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
export const typographyParts:Record<TypographyField,[string,TokenType,TokenCategory|null,string]> = {
  fontFamily: ['Семейство', 'FontFamily', null, 'Arial'],
  fontSize: ['Размер', 'Dimension', 'FontSize', '16'],
  fontWeight: ['Толщина', 'FontWeight', null, '400'],
  lineHeight: ['Интерлиньяж', 'Number', 'LineHeight', '1.25'],
  letterSpacing: ['Межбуквенный интервал', 'Dimension', 'LetterSpacing', '0']
};
export const palette:Record<string,string[]> = {
  fontStyle: ['Normal', 'Italic'],
  fontFallback: ['SansSerif', 'Serif', 'Monospace']
};
export const styleType = (style:DesignStyle|null|undefined):StyleType => !style || style.type === 0 || style.type === 'TextStyle' ? 'TextStyle' : 'BorderStyle';

export function literalOf(field:string, text:string):NodePropertyValue {
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

export function literalText(_field:string, value:NodePropertyValue|null|undefined) {
  if (!value) return '';
  if (value.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return String('value' in value?value.value??'':'');
}

export type ValueDraft={mode:'literal'|'alias';direct:string;alias:string};
export type TypographyDraft=Record<TypographyField,ValueDraft>;
export interface FieldDraft extends ValueDraft {field:string;label:string;active:boolean;tokenType:TokenType|null;category:TokenCategory|null;inline:TypographyDraft|null;fallback:string}

export function makeTypographyDraft(existing:TokenValue|null|undefined):TypographyDraft {
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
export function typographyValue(draft:TypographyDraft):NodePropertyValue {
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
