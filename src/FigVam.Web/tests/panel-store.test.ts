import { describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../src/app/panel-store';

describe('panel store', () => {
  it('updates only the subscribed panel and ignores identical snapshots', () => {
    const first = createPanelStore(0), second = createPanelStore(0);
    const a = vi.fn(), b = vi.fn(), unsubscribe = first.subscribe(a);
    second.subscribe(b);
    first.publish(1); first.publish(1);
    expect(first.getSnapshot()).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    unsubscribe(); first.publish(2);
    expect(a).toHaveBeenCalledTimes(1);
  });
});
