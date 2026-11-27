import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestRunner } from '../src/app/request-runner';
import { documentIdFromPath } from '../src/app/navigation';
import { isValidBearerToken } from '../src/features/home/session-authentication';
import { cancelRequest, setToken } from '../src/core/session';

function setup() {
  const view = { stopLive: vi.fn(), startLive: vi.fn(), message: vi.fn(), setBusy: vi.fn(), setControlsDisabled: vi.fn() };
  return { view, runner: createRequestRunner(view) };
}
describe('foreground request lifecycle', () => {
  beforeEach(() => { cancelRequest(); setToken('session'); });
  it('retains the original retry action after a failure and clears it explicitly', async () => {
    const { view, runner } = setup();
    const retry = vi.fn(async () => {});
    await runner.run(retry, async () => { throw new Error('failure'); });
    expect(runner.canRetry).toBe(true);
    expect(view.message).toHaveBeenLastCalledWith('', 'failure');
    expect(view.setControlsDisabled).toHaveBeenLastCalledWith(false);
    await runner.retry();
    expect(retry).toHaveBeenCalledOnce();
    runner.clearRetry();
    expect(runner.canRetry).toBe(false);
  });
  it('does not let superseded work release the controls or restart collaboration', async () => {
    const { view, runner } = setup();
    let finish!: () => void;
    const first = runner.run(null, (signal, current) => new Promise<void>(resolve => {
      finish = () => { expect(signal.aborted).toBe(true); expect(current()).toBe(false); resolve(); };
    }));
    let finishSecond!: () => void;
    const second = runner.run(null, () => new Promise<void>(resolve => { finishSecond = resolve; }));
    finish();
    await first;
    expect(view.startLive).not.toHaveBeenCalled();
    expect(view.setControlsDisabled).toHaveBeenLastCalledWith(true);
    finishSecond();
    await second;
    expect(view.startLive).toHaveBeenCalledOnce();
    expect(view.setControlsDisabled).toHaveBeenLastCalledWith(false);
  });
  it('does not offer an automatic retry for document creation', async () => {
    const { runner } = setup();
    await runner.run(async () => {}, async () => {}, { create: true });
    expect(runner.canRetry).toBe(false);
  });
});
describe('navigation and authentication boundaries', () => {
  it('recognizes document paths and rejects other routes', () => {
    expect(documentIdFromPath('/documents/AB12-34/')).toBe('AB12-34');
    expect(documentIdFromPath('/documents/AB12-34/edit')).toBeNull();
    expect(documentIdFromPath('/')).toBeNull();
  });
  it('rejects empty tokens and whitespace', () => {
    expect(isValidBearerToken('')).toBe(false);
    expect(isValidBearerToken('Bearer xyz')).toBe(false);
    expect(isValidBearerToken('abc.xyz')).toBe(true);
  });
});
