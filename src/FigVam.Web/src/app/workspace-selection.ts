import type { PageItem, ScreenItem } from '../api/document-queries';
import type { NavigatorKind, RenameDraft } from '../features/editor/document-navigator';
import type { DocumentStructure } from './document-workspace';

/** Owns the selected page and screen, their pinned lists, and navigation drafts. */
export function createWorkspaceSelection() {
  let page: string | null = null, screen: string | null = null;
  let pages: PageItem[] = [], screens: ScreenItem[] = [];
  let expanded = true;
  let loading = true;
  let pageDraft: RenameDraft | null = null, screenDraft: RenameDraft | null = null;
  function clearDrafts() { pageDraft = screenDraft = null; }
  function reset() { page = screen = null; pages = []; screens = []; expanded = true; loading = true; clearDrafts(); }
  return {
    get selectedPage() { return page; },
    get selectedScreen() { return screen; },
    get pages() { return pages; },
    get screens() { return screens; },
    get loading() { return loading; },
    get expanded() { return expanded; },
    get activeScreen() { return screens.find(item => item.id === screen); },
    reset,
    togglePage() { expanded = !expanded; },
    selectPage(id: string) { page = id; screen = null; screens = []; expanded = true; loading = true; },
    selectScreen(id: string) { screen = id; },
    selectAfterCommand(nextPage?: string | null, nextScreen?: string) {
      if (nextPage !== undefined && nextPage !== page) { page = nextPage; screen = null; screens = []; loading = true; }
      if (nextScreen) screen = nextScreen;
    },
    renameDraft(kind: NavigatorKind) { return kind === 'page' ? pageDraft : screenDraft; },
    setRenameDraft(kind: NavigatorKind, value: RenameDraft | null) {
      if (kind === 'page') pageDraft = value;
      else screenDraft = value;
    },
    navigatorState(canEdit: boolean) {
      if (pageDraft && (!canEdit || !pages.some(item => item.id === pageDraft?.id))) pageDraft = null;
      if (screenDraft && (!canEdit || !screens.some(item => item.id === screenDraft?.id))) screenDraft = null;
      return { pages, screens, selectedPage: page, selectedScreen: screen, pageExpanded: expanded,
        screensOffset: 0, canEdit, editingPageName: pageDraft, editingScreenName: screenDraft };
    },
    accept(structure: DocumentStructure, beforeSelectionChange: () => void) {
      const next = structure.selection;
      const pagesChanged = next.page !== page || JSON.stringify(structure.pages.items) !== JSON.stringify(pages);
      const screensChanged = next.screen !== screen || JSON.stringify(structure.screens.items) !== JSON.stringify(screens);
      if (next.page !== page || next.screen !== screen) beforeSelectionChange();
      if (next.page !== page) expanded = true;
      page = next.page; screen = next.screen; loading = false;
      pages = structure.pages.items; screens = structure.screens.items;
      return { pagesChanged, screensChanged };
    }
  };
}
