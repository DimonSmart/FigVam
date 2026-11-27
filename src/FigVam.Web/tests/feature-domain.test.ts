import { describe, expect, it } from 'vitest';
import { literalExpression } from '../src/features/tokens/token-values';
import { createStyleDraft, literalOf, makeTypographyDraft, rebaseStyleDraft, typographyValue, type DesignStyle } from '../src/features/styles/style-values';
import { readScenario, toApiScenario } from '../src/features/interactions/scenario-codec';
import { prepareNodeOperation } from '../src/features/editor/node-command';

describe('feature domain boundaries',()=>{
  it('validates token and style values without React or DOM',()=>{
    expect(literalExpression('Color',null,'#112233')).toMatchObject({expression:'literal',value:{type:'color',red:17,green:34,blue:51,alpha:255}});
    expect(()=>literalExpression('Color',null,'invalid')).toThrow();
    expect(literalOf('borderColor','#12345678')).toEqual({type:'color',red:18,green:52,blue:86,alpha:120});
    expect(()=>literalOf('borderWidth','-1')).toThrow();
    const typography=makeTypographyDraft(null);
    typography.fontSize={mode:'alias',direct:'16',alias:'size-token'};
    expect(typographyValue(typography)).toMatchObject({type:'typography',value:{fontSize:{expression:'alias',tokenId:'size-token'}}});
  });
  it('rebases independent local style fields on collaboration changes',()=>{
    const style:DesignStyle={id:'style',name:'Name',type:'BorderStyle',fields:{borderWidth:{type:'number',value:1},cornerRadius:{type:'number',value:2}},basedOnStyleId:null};
    const base=createStyleDraft(style),local=structuredClone(base);
    local.name='Draft name';
    local.rows.find(x=>x.field==='borderWidth')!.direct='7';
    const remote=createStyleDraft({...style,fields:{...style.fields,cornerRadius:{type:'number',value:10}}});
    const merged=rebaseStyleDraft(base,local,remote);
    expect(merged.name).toBe('Draft name');
    expect(merged.rows.find(x=>x.field==='borderWidth')?.direct).toBe('7');
    expect(merged.rows.find(x=>x.field==='cornerRadius')?.direct).toBe('10');
  });
  it('serializes interaction actions and rejects incomplete scenarios',()=>{
    const scenario={id:'scenario',screenId:'screen',nodeId:'node',event:0,actions:[{type:'resetPreview' as const}]};
    expect(readScenario(toApiScenario(scenario))).toEqual(scenario);
    expect(()=>toApiScenario({...scenario,event:null})).toThrow();
  });
  it('prepares node mutations with original command identity and rejects incomplete payloads',()=>{
    const op=prepareNodeOperation({documentId:'doc',command:'set-node-properties',body:{commandId:'command',nodeId:'node',properties:{x:{type:'number',value:5}}}});
    expect(op.commandId).toBe('command');
    expect(()=>prepareNodeOperation({documentId:'doc',command:'add-node',body:{commandId:'command',nodeId:'node'}})).toThrow();
  });
});
