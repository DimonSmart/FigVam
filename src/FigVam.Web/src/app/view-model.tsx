import { memo, useSyncExternalStore, type ComponentType } from 'react';
import { createPanelStore } from './panel-store';

/** A typed external view model. The component is rendered at its declared
 * position in the application tree; it never creates a root or a portal. */
export function createViewModel<P extends object>(View: ComponentType<P>) {
  const store = createPanelStore<P | null>(null);
  function Component() {
    const props = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return props ? <View {...props}/> : null;
  }
  return { Component: memo(Component), publish: store.publish, clear: () => store.publish(null) };
}
