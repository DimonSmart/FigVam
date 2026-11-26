import { beforeEach, describe, expect, it } from 'vitest';
import * as session from '../src/core/session';

describe('session request lifetime', () => {
  beforeEach(() => {
    session.cancelRequest();
    session.setToken('');
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
});
