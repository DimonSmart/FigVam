import { prepareDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { toApiNodeProperties } from '../../api/command-value-contracts';
import type { NodeProperties } from '../../canvas/canvas-model';
export interface NodeEdit {action:'set'|'add'|'move'|'delete';nodeId:string;expectedParentId?:string;parentId?:string;position?:number;kind?:string;name?:string;properties?:NodeProperties;screenId?:string;variantId?:string}
export type Command='edit-nodes'|'add-node'|'set-node-properties'|'set-screen-variant-properties'|'remove-screen-variant-override'|'remove-node-properties';
export interface Body {nodeId:string;operations?:NodeEdit[];parentId?:string;kind?:string;properties?:NodeProperties|string[];expectedParentId?:string;expectedRevision?:number|null;screenId?:string|null;variantId?:string|null;property?:string}
export function prepareNodeOperation(op:{documentId:string;command:Command;body:Body & {commandId:string}}):DocumentCommandOperation {
  const {documentId,command,body}=op;
  const {commandId,nodeId,properties,expectedRevision,expectedParentId,screenId,variantId,property,parentId,kind}=body;
  const base={commandId,nodeId};
  switch(command){
    case 'edit-nodes':
      if(expectedRevision==null||!body.operations?.length)throw new TypeError('Invalid node edit batch');
      return prepareDocumentCommand(documentId,command,{commandId,expectedRevision,operations:body.operations.map(({properties,...rest})=>({...rest,...(properties?{properties:toApiNodeProperties(properties)}:{})}))});
    case 'remove-node-properties':
      if(!Array.isArray(properties)||expectedRevision==null)throw new TypeError('Invalid property removal');
      return prepareDocumentCommand(documentId,command,{...base,properties,expectedRevision});
    case 'remove-screen-variant-override':
      if(!screenId||!variantId||!property)throw new TypeError('Invalid variant override');
      return prepareDocumentCommand(documentId,command,{...base,screenId,variantId,property,expectedRevision});
    case 'add-node':
      if(!parentId||!kind||Array.isArray(properties))throw new TypeError('Invalid node creation');
      return prepareDocumentCommand(documentId,command,{...base,parentId,kind,properties:toApiNodeProperties(properties??{})});
    case 'set-node-properties':
      if(!properties||Array.isArray(properties))throw new TypeError('Invalid properties');
      return prepareDocumentCommand(documentId,command,{...base,properties:toApiNodeProperties(properties),expectedRevision,expectedParentId});
    case 'set-screen-variant-properties':
      if(!properties||Array.isArray(properties)||!screenId||!variantId||expectedRevision==null)throw new TypeError('Invalid variant properties');
      return prepareDocumentCommand(documentId,command,{...base,screenId,variantId,expectedRevision,properties:toApiNodeProperties(properties)});
  }
}
