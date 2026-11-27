import type { ApiClient } from '../api/api-client';
import { parseDocumentList } from '../api/document-list';

type Cursor = string | null | undefined;
type Page = { index: number; cursor: Cursor };

/** Owns catalog pagination independently of the open document and its revisions. */
export function createDocumentCatalog() {
  let cursors: Cursor[] = [null];
  let pageIndex = 0;
  let nextCursor: Cursor = null;
  let loadVersion = 0;

  return {
    get canGoBack() { return pageIndex > 0; },
    get canGoForward() { return Boolean(nextCursor); },
    previous(): Page | null {
      return pageIndex > 0 ? { index: pageIndex - 1, cursor: cursors[pageIndex - 1] } : null;
    },
    next(): Page | null {
      return nextCursor ? { index: pageIndex + 1, cursor: nextCursor } : null;
    },
    beginLoad() { nextCursor = null; loadVersion++; },
    reset() { cursors = [null]; pageIndex = 0; nextCursor = null; loadVersion++; },
    async read(request: ApiClient, index: number, cursor: Cursor, pageSize: number,
      signal: AbortSignal, current: () => boolean) {
      const version = loadVersion;
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) query.set('cursor', cursor);
      const result = parseDocumentList(await request(`/api/v1/documents?${query}`, {}, signal));
      if (signal.aborted || !current() || version !== loadVersion) return null;
      pageIndex = index;
      cursors[index] = cursor;
      cursors.length = index + 1;
      nextCursor = result.nextCursor;
      return result;
    },
  };
}
