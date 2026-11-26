export let token = '';
export let generation = 0;
export let pending: AbortController | null = null;
export let navigationEpoch = 0;

export function setToken(value: string): void {
  token = value;
}
export function advanceNavigation(): void {
  navigationEpoch++;
}
export function cancelRequest(): void {
  pending?.abort();
  generation++;
}
export function startRequest(): { signal: AbortSignal; current: number } {
  const signal = replacePendingRequest();
  return { signal, current: ++generation };
}
export function replacePendingRequest(): AbortSignal {
  pending?.abort();
  pending = new AbortController();
  return pending.signal;
}
