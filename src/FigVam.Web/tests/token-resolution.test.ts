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
