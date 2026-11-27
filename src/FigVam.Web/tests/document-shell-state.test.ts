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
