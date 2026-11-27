import type { components } from './schema.generated';
import type { NodePropertyValue, TokenExpression, TokenValue } from '../core/tokens/token-model';

type Schema = components['schemas'];

export function toApiTokenExpression(value: TokenExpression): Schema['TokenExpression'] {
  return value.expression === 'alias' ? value : { expression: 'literal', value: toApiTokenValue(value.value) };
}
export function toApiTokenValue(value: TokenValue): Schema['TokenValue'] {
  switch(value.type) {
    case 'typography': return {...value, letterSpacing: value.letterSpacing ?? 0};
    case 'shadowFields': return {...value,color:toApiTokenExpression(value.color)};
    case 'typographyFields': {
      const {fontFamily,fontSize,fontWeight,lineHeight,letterSpacing}=value;
      if(!fontFamily||!fontSize||!fontWeight||!lineHeight) throw new TypeError('Incomplete typography token');
      return {type:'typographyFields',fontFamily:toApiTokenExpression(fontFamily),fontSize:toApiTokenExpression(fontSize),
        fontWeight:toApiTokenExpression(fontWeight),lineHeight:toApiTokenExpression(lineHeight),
        ...(letterSpacing ? {letterSpacing:toApiTokenExpression(letterSpacing)} : {})};
    }
    case 'spacing': return {type:'spacing',value:value.value};
    case 'dimension': return {type:'dimension',value:value.value};
    case 'number': return {type:'number',value:value.value};
    case 'fontWeight': return {type:'fontWeight',value:value.value};
    default: return value;
  }
}
export function toApiNodeValue(value: NodePropertyValue): Schema['NodePropertyValue'] {
  switch(value.type){
    case 'typography': return {type:'typography',value:toApiTokenValue(value.value)};
    case 'string': return {type:'string',value:value.value};
    case 'enum': return {type:'enum',value:value.value};
    default:return value;
  }
}
export function toApiNodeProperties(properties: Readonly<Record<string,NodePropertyValue|undefined>>): Record<string,Schema['NodePropertyValue']> {
  const result:Record<string,Schema['NodePropertyValue']>={};
  for(const [name,value] of Object.entries(properties))if(value!==undefined)result[name]=toApiNodeValue(value);
  return result;
}
