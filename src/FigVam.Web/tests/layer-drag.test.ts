import { describe, expect, it } from 'vitest';
import { resolveLayerDrop, type LayerContext } from '../src/canvas/layer-drag';

const node = (id: string, index: number, parent = 'screen', ancestors: string[] = [], childCount = 0, canContainChildren = true): LayerContext =>
  ({ item: { id, childCount, canContainChildren }, index, parent, ancestors, count: 4 });

describe('layer drop', () => {
  it('computes destination in the order after source removal', () => {
    expect(resolveLayerDrop(node('a', 0), node('b', 2), 'after')).toEqual({
      expectedParentId: 'screen', targetParentId: 'screen', position: 2, reveal: [],
    });
  });
  it('does not generate no-op or cyclic moves', () => {
    expect(resolveLayerDrop(node('a', 0), node('b', 1), 'before')).toBeNull();
    expect(resolveLayerDrop(node('a', 0), node('b', 0, 'a', ['a']), 'inside')).toBeNull();
  });
  it('moves inside an eligible container and expands its ancestors', () => {
    expect(resolveLayerDrop(node('a', 0), node('b', 1, 'group', ['group'], 3), 'inside')).toEqual({
      expectedParentId: 'screen', targetParentId: 'b', position: 3, reveal: ['group', 'b'],
    });
    expect(resolveLayerDrop(node('a', 0), node('b', 1, 'screen', [], 0, false), 'inside')).toBeNull();
  });
});
