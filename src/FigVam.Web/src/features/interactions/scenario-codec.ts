import type { components } from '../../api/schema.generated';
import { requiredRecord, array, text } from '../../api/decode';
import { actionLabels, type ScenarioDraft } from './interaction-model';
export function toApiScenario(scenario:ScenarioDraft):components['schemas']['PreviewScenario']{
  if(scenario.event===null)throw new TypeError('Выберите событие');
  return {id:scenario.id,screenId:scenario.screenId,nodeId:scenario.nodeId,event:scenario.event,actions:scenario.actions.map((action):components['schemas']['PreviewAction']=>{
    switch(action.type){
      case 'navigate':case 'openOverlay':
        if(!action.screenId)throw new TypeError('Выберите экран');
        return {type:action.type,screenId:action.screenId};
      case 'showVariant':return {type:action.type,variantId:action.variantId??null};
      case 'selectDataset':return {type:action.type,datasetId:action.datasetId??null};
      case 'setDemoValue':
        if(!action.nodeId)throw new TypeError('Выберите элемент');
        return {type:action.type,nodeId:action.nodeId,value:action.value??null};
      case 'closeOverlay':case 'resetPreview':return {type:action.type};
      default:throw new TypeError('Выберите действие');
    }
  })};
}
export function readScenario(value:unknown):ScenarioDraft{const s=requiredRecord(value);if(typeof s.event!=='number'||!Number.isInteger(s.event))throw new TypeError('Некорректное взаимодействие');return{id:text(s.id),screenId:text(s.screenId),nodeId:text(s.nodeId),event:s.event,actions:array(s.actions,a=>{const v=requiredRecord(a),type=text(v.type);if(!Object.hasOwn(actionLabels,type))throw new TypeError('Неизвестное действие');switch(type){case 'navigate':case 'openOverlay':return{type,screenId:text(v.screenId)};case 'showVariant':return{type,variantId:v.variantId==null?null:text(v.variantId)};case 'selectDataset':return{type,datasetId:v.datasetId==null?null:text(v.datasetId)};case 'setDemoValue':return{type,nodeId:text(v.nodeId),value:v.value==null?null:text(v.value)};case 'closeOverlay':case 'resetPreview':return{type};default:throw new TypeError('Неизвестное действие');}})};}
