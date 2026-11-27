/** Session-scoped credentials, cancellation and navigation. Only the composition
 * root creates an instance; consumers receive narrow dependencies. */
export function createSessionLifecycle() {
  let token = '', generation = 0, navigationEpoch = 0, sessionEpoch = 0;
  let pending: AbortController | null = null;
  let lifetime = new AbortController();
  let navigationLifetime = new AbortController();
  function cancelRequest(): void {
    pending?.abort();
    pending = null;
    generation++;
  }
  function setToken(value: string): void {
    lifetime.abort();
    cancelRequest();
    token = value;
    sessionEpoch++;
    advanceNavigation();
    lifetime = new AbortController();
  }
  function advanceNavigation(): void {
    navigationLifetime.abort();
    navigationLifetime = new AbortController();
    navigationEpoch++;
  }
  function replacePendingRequest(): AbortSignal {
    cancelRequest();
    pending = new AbortController();
    return pending.signal;
  }
  function startRequest(): { signal: AbortSignal; current: number } {
    return { signal: replacePendingRequest(), current: generation };
  }
  return {
    get token() { return token; },
    get generation() { return generation; },
    get pending() { return pending; },
    get navigationEpoch() { return navigationEpoch; },
    get sessionEpoch() { return sessionEpoch; },
    get signal() { return lifetime.signal; },
    get navigationSignal() { return navigationLifetime.signal; },
    setToken, advanceNavigation, cancelRequest, startRequest, replacePendingRequest,
  };
}
export type SessionLifecycle = ReturnType<typeof createSessionLifecycle>;
