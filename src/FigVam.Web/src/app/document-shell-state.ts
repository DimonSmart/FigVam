import { createPanelStore } from './panel-store';

export interface DocumentShellState {
  role: string | null;
  title: string;
  revisionLabel: string;
  connectionStatus: string;
  renameName: string;
  renameBusy: boolean;
  renameStatus: string;
  renameError: string;
  pageBusy: boolean;
  hasPage: boolean;
  hasScreen: boolean;
  layersTitle: string;
  screenWidth: string;
  screenHeight: string;
}
export function canEditDocument(role: string | null) { return role === 'Owner' || role === 'Editor'; }
export function createDocumentShellModel() {
  const initial: DocumentShellState = {
    role: null, title: '', revisionLabel: '', connectionStatus: '', renameName: '', renameBusy: false, renameStatus: '', renameError: '',
    pageBusy: false, hasPage: false, hasScreen: false, layersTitle: 'Слои выбранного экрана', screenWidth: '1440', screenHeight: '900',
  };
  const store = createPanelStore(initial);
  return {
    ...store,
    patch(changes: Partial<DocumentShellState>) {
      const previous = store.getSnapshot();
      if ((Object.keys(changes) as (keyof DocumentShellState)[]).every(key => Object.is(previous[key], changes[key]))) return;
      store.publish({ ...previous, ...changes });
    },
  };
}
export type DocumentShellModel = ReturnType<typeof createDocumentShellModel>;

export function createDeletionViewModel() {
  return createPanelStore<{ status: 'idle' | 'pending' | 'uncertain'; message: string }>({ status: 'idle', message: '' });
}
export type DeletionViewModel = ReturnType<typeof createDeletionViewModel>;
