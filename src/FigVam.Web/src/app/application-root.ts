import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | undefined;

/** Single bootstrap boundary: legacy controllers still need mounted elements
 * during composition. No view can create another application root. */
export function mountApplicationRoot(view: ReactNode) {
  if (root) throw new Error('Application root already mounted');
  const host = document.getElementById('figvam-app');
  if (!host) throw new Error('Missing application root');
  const mounted = createRoot(host);
  root = mounted;
  flushSync(() => mounted.render(view));
}

/** Dispose only when actually unloading, not on bfcache entry. */
export function disposeApplicationRoot() {
  root?.unmount();
  root = undefined;
}
