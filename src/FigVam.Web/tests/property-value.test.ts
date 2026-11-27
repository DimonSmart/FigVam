import { describe, expect, it, vi } from 'vitest';
import { createNodeValueSpec,createValueField,createShadowSpec,shadowPreset } from '../src/ui/property-value';
import type { PropertyModel } from '../src/ui/property-control-contract';

const model:PropertyModel={tokens:new Map(),assets:new Map()};
describe('React property field models',()=>{
  it('keeps raw numeric drafts separate from rounded confirmed values',()=>{
    const onEdit=vi.fn(),spec=createNodeValueSpec('x',{type:'Number',minimum:-100,maximum:100,defaultValue:{type:'number',value:0}},model,undefined,'visual-property');
    const field=createValueField(spec,'x',{onEdit});
    field.edit('12.3456','input');
    expect(field.read()).toBe('12.3456');
    expect(field.validate(false)).toEqual({value:{type:'number',value:12.35}});
    expect(onEdit).toHaveBeenCalledWith('input');
    field.edit('','input');
    expect(field.validate(false).error).toContain('Введите число');
    field.write(spec.initial);
    expect(field.read()).toBe('0');
  });
  it('validates a deleted token and never unlinks it to a default number',()=>{
    const spec=createNodeValueSpec('gap',{type:'Number',tokenType:'Spacing',defaultValue:{type:'number',value:99}},model,{type:'token',tokenId:'missing'},'visual-property');
    expect(spec.kind).toBe('reference');
    if(spec.kind!=='reference')throw new Error('Expected reference field');
    expect(spec.validate(spec.initial).error).toContain('отсутствует');
    const raw=spec.direct.resolvedRaw?.(spec.resolve('missing'));
    expect(raw).toBe('');
    expect(spec.validate(['number',raw??null,'']).error).toContain('Введите число');
  });
  it('validates typed shadow and rejects out-of-range dimensions and alpha',()=>{
    const spec=createShadowSpec(shadowPreset);
    expect(spec.validate(spec.initial)).toEqual({value:shadowPreset});
    expect(spec.validate(['0','4','257','0','#000000','38']).error).toBeTruthy();
    expect(spec.validate(['0','4','8','0','#000000','256']).index).toBe(6);
  });
  it('does not publish an unchanged disabled state or programmatic raw write',()=>{
    const spec=createNodeValueSpec('visible',{type:'Boolean',defaultValue:{type:'boolean',value:true}},model,undefined,'visual-property');
    const field=createValueField(spec,'visible'),listener=vi.fn(),unsubscribe=field.store.subscribe(listener);
    field.setDisabled(false);field.write(true);
    expect(listener).not.toHaveBeenCalled();
    field.setDisabled(true);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
