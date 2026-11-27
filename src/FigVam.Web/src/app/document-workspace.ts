import type { PageItem, ScreenItem, createDocumentQueries } from '../api/document-queries';

type Queries = ReturnType<typeof createDocumentQueries>;
interface Selection { page: string | null; screen: string | null }
export interface DocumentStructure {
  revision: number;
  pages: { items: PageItem[]; total: number };
  screens: { items: ScreenItem[]; total: number };
  selection: Selection;
}

/** A full tree refresh pins both lists to one immutable server revision. */
export async function readDocumentStructure(queries: Queries, id: string, signal: AbortSignal,
  valid: () => boolean, targetRevision: number | null, selection: Selection): Promise<DocumentStructure | null> {
  const pages = await queries.readPages(id, signal, valid, targetRevision);
  if (signal.aborted || !valid() || !pages) return null;
  const page = pages.items.some(item => item.id === selection.page) ? selection.page : pages.items[0]?.id ?? null;
  let screen = page === selection.page ? selection.screen : null;
  let screens: DocumentStructure['screens'] = { items: [], total: 0 };
  if (page) {
    const result = await queries.readScreens(id, page, signal, valid, pages.revision);
    if (signal.aborted || !valid() || !result) return null;
    screens = result;
  }
  if (!screens.items.some(item => item.id === screen)) screen = null;
  return { revision: pages.revision, pages, screens, selection: { page, screen } };
}

/** The catalog revision is the last complete resource/tree read, not a second
 * source of truth for the current confirmed document revision. */
export function createDocumentRevisionState() {
  let revision: number | null = null;
  let catalogRevision: number | null = null;
  return {
    get revision() { return revision; },
    get catalogRevision() { return catalogRevision; },
    confirmStructure(next: number) { revision = catalogRevision = next; },
    confirmNodeEdit(next: number) { revision = next; },
    reset() { revision = catalogRevision = null; },
  };
}
