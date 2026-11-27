import { describe, expect, it } from 'vitest';
import { createWorkspaceSelection } from '../src/app/workspace-selection';
import type { DocumentStructure } from '../src/app/document-workspace';

const structure: DocumentStructure = { revision: 1, pages: { items: [{ id: 'p', type: 'page', name: 'Page' }], total: 1 },
  screens: { items: [{ id: 's', type: 'screen', dimensions: { width: 100, height: 100 } }], total: 1 },
  selection: { page: 'p', screen: 's' } };
describe('workspace selection', () => {
  it('updates both lists and selection only after the previous context is cleared', () => {
    const state = createWorkspaceSelection();
    expect(state.accept(structure, () => expect(state.selectedScreen).toBeNull())).toEqual({pagesChanged:true,screensChanged:true});
    expect(state.activeScreen?.id).toBe('s');
    expect(state.accept(structure, () => { throw Error('unchanged'); })).toEqual({pagesChanged:false,screensChanged:false});
    state.selectPage('other');
    expect(state.selectedScreen).toBeNull();
    expect(state.screens).toEqual([]);
  });
  it('keeps valid navigation drafts and discards stale or unauthorized ones', () => {
    const state = createWorkspaceSelection();
    state.accept(structure, () => {});
    state.setRenameDraft('screen', {id:'s',value:'Draft'});
    expect(state.navigatorState(true).editingScreenName?.value).toBe('Draft');
    expect(state.navigatorState(false).editingScreenName).toBeNull();
    state.setRenameDraft('page', {id:'missing',value:'Draft'});
    expect(state.navigatorState(true).editingPageName).toBeNull();
    state.reset();
    expect(state.selectedPage).toBeNull();
    expect(state.pages).toEqual([]);
  });
});
