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
  layerMoveEnabled: boolean;
  structureLoading: boolean;
  selectedPageEmpty: boolean;
  hasPage: boolean;
  hasScreen: boolean;
  layersTitle: string;
  screenPreset: string;
  screenWidth: string;
  screenHeight: string;
}
export function canEditDocument(role: string | null) { return role === 'Owner' || role === 'Editor'; }
export function createDocumentShellModel() {
  const initial: DocumentShellState = {
    role: null, title: '', revisionLabel: '', connectionStatus: '', renameName: '', renameBusy: false, renameStatus: '', renameError: '',
    pageBusy: false, layerMoveEnabled: false, structureLoading: true, selectedPageEmpty: false, hasPage: false, hasScreen: false, layersTitle: 'Слои выбранного экрана', screenPreset: '1440x900', screenWidth: '1440', screenHeight: '900',
  };
  const store = createPanelStore(initial);
  return {
    ...store,
    setScreenPreset(preset: string) {
      const previous = store.getSnapshot();
      if (preset === 'custom') { store.publish({ ...previous, screenPreset: preset }); return; }
      if (!['1440x900', '390x844', '768x1024'].includes(preset)) return;
      const [width, height] = preset.split('x');
      store.publish({ ...previous, screenPreset: preset, screenWidth: width!, screenHeight: height! });
    },
    setScreenDimension(axis: 'screenWidth' | 'screenHeight', value: string) {
      const next = { ...store.getSnapshot(), [axis]: value };
      const dimensions = next.screenWidth + 'x' + next.screenHeight;
      next.screenPreset = ['1440x900', '390x844', '768x1024'].includes(dimensions) ? dimensions : 'custom';
      store.publish(next);
    },
    resetScreenForm() { store.publish({ ...store.getSnapshot(), screenPreset: initial.screenPreset, screenWidth: initial.screenWidth, screenHeight: initial.screenHeight }); },
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
