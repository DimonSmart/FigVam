import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createPanelStore } from './panel-store';

interface Panel {
  id: number;
  host: HTMLElement;
  store: ReturnType<typeof createPanelStore<ReactNode>>;
}
let nextId = 0;
const panels = new Map<number, Panel>();
let root: Root | undefined;
let application: ReactNode = null;

function PanelContent({ panel }: { panel: Panel }) {
  const children = useSyncExternalStore(panel.store.subscribe, panel.store.getSnapshot);
  return createPortal(children, panel.host);
}
function publishPanels() {
  if (!root) throw new Error('Application root is not mounted');
  root.render(<>{application}{[...panels.values()].map(panel => <PanelContent key={panel.id} panel={panel}/>)}</>);
}

/** One synchronous mount is required before wiring the remaining legacy controllers. */
export function mountApplicationRoot(view: ReactNode) {
  if (root) throw new Error('Application root already mounted');
  const host=document.getElementById('figvam-app');
  if(!host)throw new Error('Missing application root');
  application=view;
  root=createRoot(host);
  flushSync(publishPanels);
}

/** Transitional portal adapter for the existing shell. All React panels share
 * the application root; updating an individual slot only notifies its own
 * subscribers, including the high-frequency presence markers. */
export function createPanelRoot(host: HTMLElement) {
  const panel: Panel = { id: ++nextId, host, store: createPanelStore<ReactNode>(null) };
  let mounted = false;
  return {
    render(children: ReactNode) {
      if (!mounted) {
        // React portals, unlike independent roots, do not replace old children.
        host.replaceChildren();
        mounted = true;
        panels.set(panel.id, panel);
        panel.store.publish(children);
        publishPanels();
      } else panel.store.publish(children);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      panels.delete(panel.id);
      panel.store.publish(null);
      publishPanels();
    },
  };
}

/** Dispose the application root only when actually unloading, not on bfcache entry. */
export function disposeApplicationRoot() {
  root?.unmount();
  panels.clear();
  root = undefined;
  application = null;
}
