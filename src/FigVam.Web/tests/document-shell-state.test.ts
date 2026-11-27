import { describe, expect, it } from 'vitest';
import { canEditDocument, createDocumentShellModel, createDeletionViewModel } from '../src/app/document-shell-state';
describe('document shell state', () => {
  it('derives edit access from the current role', () => {
    const model = createDocumentShellModel();
    expect(canEditDocument(model.getSnapshot().role)).toBe(false);
    for (const role of ['Owner', 'Editor', 'Viewer', null]) {
      model.patch({ role });
      expect(canEditDocument(model.getSnapshot().role)).toBe(role === 'Owner' || role === 'Editor');
    }
  });
  it('keeps a custom preset and restores default dimensions on reset', () => {
    const model = createDocumentShellModel();
    model.setScreenPreset('768x1024');
    model.setScreenPreset('custom');
    expect(model.getSnapshot()).toMatchObject({ screenPreset: 'custom', screenWidth: '768', screenHeight: '1024' });
    model.setScreenDimension('screenWidth', '1440');
    expect(model.getSnapshot().screenPreset).toBe('custom');
    model.setScreenDimension('screenHeight', '900');
    expect(model.getSnapshot().screenPreset).toBe('1440x900');
    model.setScreenPreset('390x844');
    model.resetScreenForm();
    expect(model.getSnapshot()).toMatchObject({ screenPreset: '1440x900', screenWidth: '1440', screenHeight: '900' });
  });
  it('preserves a rename draft when a confirmed revision changes', () => {
    const model = createDocumentShellModel();
    model.patch({ title: 'Before', renameName: 'Draft' });
    model.patch({ title: 'Remote', revisionLabel: '2' });
    expect(model.getSnapshot()).toMatchObject({ title: 'Remote', renameName: 'Draft', revisionLabel: '2' });
  });
  it('retains the uncertain deletion result independently of the open document', () => {
    const model = createDocumentShellModel(), deletion = createDeletionViewModel();
    deletion.publish({ status: 'uncertain', message: 'Unknown' });
    model.patch({ role: null, title: '' });
    expect(deletion.getSnapshot()).toEqual({ status: 'uncertain', message: 'Unknown' });
  });
});
