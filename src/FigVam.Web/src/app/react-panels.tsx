import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
let container: HTMLElement | undefined;

function PanelContent({ panel }: { panel: Panel }) {
  const children = useSyncExternalStore(panel.store.subscribe, panel.store.getSnapshot);
  return createPortal(children, panel.host);
}
function publishPanels() {
  if (!root) {
    container = document.createElement('div');
    container.hidden = true;
    container.dataset.figvamAppRoot = '';
    document.body.append(container);
    root = createRoot(container);
  }
  root.render(<>{[...panels.values()].map(panel => <PanelContent key={panel.id} panel={panel}/>)}</>);
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
  container?.remove();
  root = undefined;
  container = undefined;
}
