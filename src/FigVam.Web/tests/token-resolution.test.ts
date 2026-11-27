import { describe, expect, it } from 'vitest';
import { resolveInlineTypography, resolvePropertyToken, resolveTokenValue } from '../src/core/tokens/token-resolution';
import type { DesignToken } from '../src/core/tokens/token-model';

describe('token resolution', () => {
  const dimension: DesignToken = { id: 'dimension', name: 'Size', type: 'Dimension', category: 'Size',
    values: { Light: { expression: 'literal', value: { type: 'dimension', value: 20 } },
      Dark: { expression: 'literal', value: { type: 'dimension', value: 40 } } } };
  const alias: DesignToken = { id: 'alias', name: 'Alias', type: 'Dimension', category: 'Size',
    values: { Light: { expression: 'alias', tokenId: 'dimension' }, Dark: { expression: 'alias', tokenId: 'dimension' } } };
  it('resolves aliases in the requested document theme', () => {
    const tokens = new Map([[dimension.id, dimension], [alias.id, alias]]);
    expect(resolveTokenValue({ type: 'token', tokenId: 'alias' }, tokens, 'Dark'))
      .toMatchObject({ value: { type: 'dimension', value: 40 }, error: null });
    expect(resolvePropertyToken({ type: 'token', tokenId: 'alias' }, tokens, 'Dark',
      { type: 'Number', tokenType: 'Dimension', tokenCategory: 'Size', maximum: 30 }).error).toContain('пределы');
  });
  it('resolves nested shadow color without discarding alpha or alias identity', () => {
    const color:DesignToken={id:'color',name:'Color',type:'Color',values:{
      Light:{expression:'literal',value:{type:'color',red:0,green:0,blue:0,alpha:32}},
      Dark:{expression:'literal',value:{type:'color',red:255,green:255,blue:255,alpha:96}}}};
    const shadow:DesignToken={id:'shadow',name:'Shadow',type:'Shadow',values:{
      Dark:{expression:'literal',value:{type:'shadowFields',offsetX:0,offsetY:4,blurRadius:8,spreadRadius:0,color:{expression:'alias',tokenId:'color'}}}}};
    const tokens=new Map([[color.id,color],[shadow.id,shadow]]);
    expect(resolveTokenValue({type:'token',tokenId:'shadow'},tokens,'Dark')).toMatchObject({
      value:{type:'shadow',color:{red:255,green:255,blue:255,alpha:96}},error:null});
    expect(resolveTokenValue({type:'token',tokenId:'shadow'},new Map([[shadow.id,shadow]]),'Dark').error).toContain('color:');
  });
  it('rejects cycles and missing theme expressions', () => {
    const cycle: DesignToken = { ...alias, values: { Light: { expression: 'alias', tokenId: 'alias' } } };
    const tokens = new Map([[cycle.id, cycle]]);
    expect(resolveTokenValue({ type: 'token', tokenId: 'alias' }, tokens).error).toContain('Цикл');
    expect(resolveTokenValue({ type: 'token', tokenId: 'alias' }, tokens, 'Dark').error).toContain('Dark');
  });
  it('resolves typography fields and preserves zero default tracking', () => {
    expect(resolveInlineTypography({ type: 'typographyFields',
      fontFamily: { expression: 'literal', value: { type: 'fontFamily', value: 'Inter' } },
      fontSize: { expression: 'literal', value: { type: 'dimension', value: 14 } },
      fontWeight: { expression: 'literal', value: { type: 'fontWeight', value: 400 } },
      lineHeight: { expression: 'literal', value: { type: 'number', value: 1.4 } },
    }, new Map())).toEqual({ value: { type: 'typography', fontFamily: 'Inter', fontSize: 14,
      fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 }, error: null });
  });
});
