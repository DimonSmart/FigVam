import { describe, expect, it } from 'vitest';
import { createApplicationShellState } from '../src/app/application-shell-state';

describe('application shell state', () => {
  it('publishes immutable snapshots and skips unchanged fields', () => {
    const model = createApplicationShellState();
    const initial = model.getSnapshot();
    let updates = 0;
    const unsubscribe = model.subscribe(() => updates++);
    model.patch({ authenticated: true, view: 'documents' });
    expect(initial.authenticated).toBe(false);
    expect(model.getSnapshot().view).toBe('documents');
    model.patch({ view: 'documents' });
    expect(updates).toBe(1);
    unsubscribe();
    model.patch({ view: 'editor' });
    expect(updates).toBe(1);
  });
  it('clears import feedback and invalidates the native file picker', () => {
    const model = createApplicationShellState();
    model.patch({ importBusy: true, importStatus: 'loading', importDiagnostics: ['diagnostic'], importError: 'error' });
    model.resetImport();
    expect(model.getSnapshot()).toMatchObject({ importBusy: false, importFile: null, importReset: 1, importStatus: '', importError: '', importDiagnostics: [] });
  });
});
