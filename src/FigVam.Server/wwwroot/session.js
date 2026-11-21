export let token = '';
export let generation = 0;
export let pending = null;
export let navigationEpoch = 0;

export function setToken(value) {
  token = value;
}

export function advanceNavigation() {
  navigationEpoch++;
}

export function cancelRequest() {
  pending?.abort();
  generation++;
}

export function startRequest() {
  const signal = replacePendingRequest();
  return { signal, current: ++generation };
}

export function replacePendingRequest() {
  pending?.abort();
  pending = new AbortController();
  return pending.signal;
}
