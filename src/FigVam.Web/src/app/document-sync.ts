import type { createDocumentQueries } from '../api/document-queries';
import type { createLayers } from '../features/editor/layers';
import type { createTokens } from '../features/tokens/tokens';
import type { createStyles } from '../features/styles/styles';
import { readDocumentStructure, type DocumentStructure } from './document-workspace';

export type SelectionChange = { nodeId: string; previousId?: string };
type Layers = ReturnType<typeof createLayers>;
type Tokens = ReturnType<typeof createTokens>;
type Styles = ReturnType<typeof createStyles>;
type LayerSnapshot = Awaited<ReturnType<Layers['readSnapshot']>>;
type UsageSnapshot = Awaited<ReturnType<Tokens['readSelectedUsages']>>;
type TokenSnapshot = Awaited<ReturnType<Tokens['read']>>;
type StyleSnapshot = Awaited<ReturnType<Styles['read']>>;

interface Context {
  documentId: string | null;
  screen: string | null;
  page: string | null;
  generation: number;
  revision: number | null;
}
interface Dependencies {
  context(): Context;
  shouldReportFailure(signal: AbortSignal): boolean;
  queries: ReturnType<typeof createDocumentQueries>;
  layers: Pick<Layers, 'readSnapshot' | 'isExpansionCurrent'>;
  tokens: Pick<Tokens, 'read' | 'readSelectedUsages'>;
  styles: Pick<Styles, 'read'>;
  applyNodeEdit(revision: number, screen: string | null, layers: LayerSnapshot, usages: UsageSnapshot,
    change?: SelectionChange, resourcesChanged?: boolean): void;
  applyStructure(structure: DocumentStructure, layers: LayerSnapshot, tokens: TokenSnapshot,
    styles: StyleSnapshot, name: string, change?: SelectionChange): void;
}

/** Reads pinned snapshots and never commits work from an obsolete request. */
export function createDocumentSync(deps: Dependencies) {
  const { context, queries, layers, tokens, styles } = deps;
  async function readNodeEditRevision(signal: AbortSignal, newRevision: number, isCurrent: () => boolean,
    reveal: string[], change?: SelectionChange, resourcesChanged = false): Promise<true | undefined> {
    const start = context();
    if (!start.documentId) return;
    const valid = () => {
      const now = context();
      return !signal.aborted && start.generation === now.generation && start.revision === now.revision &&
        start.documentId === now.documentId && start.screen === now.screen && isCurrent();
    };
    const base = `/api/v1/documents/${encodeURIComponent(start.documentId)}`;
    const [snapshot, usages] = await Promise.all([
      layers.readSnapshot({ base, screen: start.screen, revision: newRevision, signal, isCurrent: valid, reveal,
        shouldReportFailure: () => deps.shouldReportFailure(signal) }),
      tokens.readSelectedUsages(base, newRevision, signal, valid)
    ]);
    if (!valid()) return;
    if (!layers.isExpansionCurrent(snapshot))
      return readNodeEditRevision(signal, newRevision, isCurrent, reveal, change, resourcesChanged);
    deps.applyNodeEdit(newRevision, start.screen, snapshot, usages, change, resourcesChanged);
    return true;
  }

  async function readPages(signal: AbortSignal, _offset = 0, targetRevision: number | null = null,
    isCurrent = () => true, reveal: string[] = [], change?: SelectionChange): Promise<true | undefined> {
    const start = context();
    if (!start.documentId) return;
    const valid = () => {
      const now = context();
      return !signal.aborted && start.documentId === now.documentId && start.generation === now.generation && isCurrent();
    };
    const base = `/api/v1/documents/${encodeURIComponent(start.documentId)}`;
    const structure = await readDocumentStructure(queries, start.documentId, signal, valid, targetRevision,
      { page: start.page, screen: start.screen });
    if (!structure || !valid()) return;
    const { revision, selection: { screen } } = structure;
    const snapshot = await layers.readSnapshot({ base, screen, revision, signal, isCurrent: valid, reveal,
      shouldReportFailure: () => deps.shouldReportFailure(signal) });
    const [tokenSnapshot, styleSnapshot] = await Promise.all([
      tokens.read(base, revision, signal, valid), styles.read(base, revision, signal, valid)
    ]);
    const name = await queries.readName(start.documentId, signal, revision, valid);
    if (!valid()) return;
    if (!layers.isExpansionCurrent(snapshot)) return readPages(signal, 0, revision, isCurrent, reveal, change);
    deps.applyStructure(structure, snapshot, tokenSnapshot, styleSnapshot, name, change);
    return true;
  }
  return { readNodeEditRevision, readPages };
}
