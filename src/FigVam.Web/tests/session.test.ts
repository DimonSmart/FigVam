import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionLifecycle } from '../src/core/session';
let session: ReturnType<typeof createSessionLifecycle>;

describe('session request lifetime', () => {
  beforeEach(() => {
    session = createSessionLifecycle();
  });

  it('aborts a superseded request and changes its generation', () => {
    const first = session.startRequest();
    const second = session.startRequest();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.current).toBe(first.current + 1);
    session.cancelRequest();
    expect(second.signal.aborted).toBe(true);
    expect(session.generation).toBe(second.current + 1);
  });

  it('tracks navigation separately from request generations', () => {
    const epoch = session.navigationEpoch;
    const generation = session.generation;
    session.advanceNavigation();
    expect(session.navigationEpoch).toBe(epoch + 1);
    expect(session.generation).toBe(generation);
  });
  it('does not cancel independent synchronization on foreground replacement', () => {
    const synchronization=session.navigationSignal;
    const first=session.startRequest();
    session.startRequest();
    expect(first.signal.aborted).toBe(true);
    expect(synchronization.aborted).toBe(false);
    session.advanceNavigation();
    expect(synchronization.aborted).toBe(true);
    const next=session.navigationSignal;
    session.setToken('new');
    expect(next.aborted).toBe(true);
  });
  it('invalidates the session even when the next credentials are identical', () => {
    session.setToken('same');
    const epoch = session.sessionEpoch, signal = session.signal;
    const work = session.startRequest();
    session.setToken('same');
    expect(signal.aborted).toBe(true);
    expect(work.signal.aborted).toBe(true);
    expect(session.signal.aborted).toBe(false);
    expect(session.sessionEpoch).toBe(epoch + 1);
  });
  it('keeps independent session instances isolated', () => {
    const other = createSessionLifecycle();
    const operation = other.startRequest();
    session.setToken('first');
    session.cancelRequest();
    expect(other.token).toBe('');
    expect(operation.signal.aborted).toBe(false);
    expect(other.generation).toBe(operation.current);
  });
  it('invalidates the previous generation when replacing a foreground request', () => {
    const first = session.startRequest();
    const second = session.replacePendingRequest();
    expect(first.signal.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(session.generation).toBe(first.current + 1);
  });
});
