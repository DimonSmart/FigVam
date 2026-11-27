import { createPanelStore } from './panel-store';

export interface ApplicationShellState {
  authenticated: boolean;
  view: 'none' | 'documents' | 'editor';
  homeView: 'documents' | 'users';
  busy: boolean;
  controlsDisabled: boolean;
  catalog: { count: number; index: number; canGoBack: boolean; canGoForward: boolean } | null;
  status: string;
  error: string;
  canRetry: boolean;
  documentName: string;
  importFile: File | null;
  importReset: number;
  importBusy: boolean;
  importStatus: string;
  importError: string;
  importDiagnostics: string[];
}

export function createApplicationShellState() {
  const store = createPanelStore<ApplicationShellState>({
    authenticated: false, view: 'none', homeView: 'documents', busy: false, controlsDisabled: false,
    catalog: null, status: '', error: '', canRetry: false, documentName: '',
    importFile: null, importReset: 0, importBusy: false, importStatus: '', importError: '', importDiagnostics: [],
  });
  function patch(changes: Partial<ApplicationShellState>) {
    const previous = store.getSnapshot();
    if ((Object.keys(changes) as (keyof ApplicationShellState)[]).every(key => Object.is(previous[key], changes[key]))) return;
    store.publish({ ...previous, ...changes });
  }
  return {
    ...store, patch,
    resetImport() {
      patch({ importFile: null, importReset: store.getSnapshot().importReset + 1, importStatus: '', importError: '', importDiagnostics: [], importBusy: false });
    },
  };
}
export type ApplicationShellModel = ReturnType<typeof createApplicationShellState>;
export interface ApplicationShellActions {
  createDocument(): void;
  changeDocumentName(name: string): void;
  chooseImportFile(file: File | null): void;
  importDocument(): void;
  refresh(): void;
  previous(): void;
  next(): void;
  retry(): void;
}
