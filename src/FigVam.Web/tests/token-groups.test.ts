import { describe, expect, it } from 'vitest';
import { buildTokenGroups, tokenNameDiagnostics, tokenNameError, tokensInGroup } from '../src/core/tokens/token-groups';
import { splitTokenBundle } from '../src/core/tokens/token-exchange';

describe('token grouping and exchange', () => {
  it('preserves original group segments and detects case-insensitive conflicts', () => {
    const items = [{ id: '1', name: 'Color/Primary' }, { id: '2', name: 'Color.Secondary' }];
    const root = buildTokenGroups(items);
    expect(root.children.get('Color')?.count).toBe(2);
    expect(tokensInGroup(items, ['Color'])).toEqual(items);
    expect(tokenNameError('color.primary', items)).toContain('Конфликт');
    expect(tokenNameDiagnostics([...items, { id: '3', name: 'Color' }]).size).toBe(3);
  });
  it('preserves duplicate DTCG property names for authoritative server validation', () => {
    const source = '{"format":"figvam-tokens","version":1,"themes":{"Light":{"a":1,"a":2},"Dark":{}}}';
    expect(splitTokenBundle(source)).toEqual({ lightJson: '{"a":1,"a":2}', darkJson: '{}' });
  });
  it('rejects duplicate envelope fields', () => {
    expect(() => splitTokenBundle('{"format":"figvam-tokens","version":1,"themes":{"Light":{},"Light":{},"Dark":{}}}')).toThrow('Повторяющееся поле');
  });
});
