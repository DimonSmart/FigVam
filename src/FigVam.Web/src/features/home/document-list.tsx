import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { DocumentListItem } from '../../api/document-list';
import { Button } from '../../ui/Button';

export interface DeleteCatalogCommand {
  commandId: string;
  expectedRevision: number;
}

type DeleteDocument = (item: DocumentListItem, command: DeleteCatalogCommand) => Promise<void>;

const roleLabels: Readonly<Partial<Record<string, string>>> = {
  Owner: 'Владелец', Editor: 'Редактор', Viewer: 'Просмотр',
};
const compatibilityLabels: Readonly<Partial<Record<string, string>>> = {
  PROFILE_UNAVAILABLE: 'Профиль не установлен', INVALID_PROFILE: 'Некорректный профиль',
  UNSUPPORTED_STORAGE_SCHEMA: 'Несовместимый формат хранения', METADATA_UNAVAILABLE: 'Метаданные недоступны',
};

function DocumentCard({ item, onDelete }: { item: DocumentListItem; onDelete: DeleteDocument }) {
  const command = useRef<DeleteCatalogCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = item.revision;
  const canDelete = item.compatibilityIssue && item.role === 'Owner'
    && revision !== null && Number.isSafeInteger(revision) && revision >= 0;
  const versions = [
    item.profileVersion !== null && item.profileVersion > 0 ? `Профиль: v${item.profileVersion}` : '',
    item.storageSchemaVersion !== null ? `Хранилище: v${item.storageSchemaVersion}` : '',
    revision !== null ? `Ревизия: ${revision}` : '',
  ].filter(Boolean);
  async function remove() {
    if (!canDelete || revision === null || busy) return;
    if (!command.current && !window.confirm(`Удалить документ «${item.name}»? Это действие нельзя отменить.`)) return;
    command.current ??= { commandId: crypto.randomUUID(), expectedRevision: revision };
    setBusy(true);
    try { await onDelete(item, command.current); }
    finally { setBusy(false); }
  }
  return <li>
    <div className="document-art" aria-hidden="true">
      <div className="document-art-window"><div className="document-art-content">
        <div className="document-art-rail" /><div className="document-art-lines"><span /><span /><span /></div>
      </div></div>
    </div>
    <div className="document-card-meta">
      {item.compatibilityIssue
        ? <span className="document-unavailable-name">{item.name}</span>
        : <a href={`/documents/${encodeURIComponent(item.documentId)}`} data-navigation="">{item.name}</a>}
      <span className="document-role">{roleLabels[item.role] ?? item.role}</span>
      {versions.length > 0 && <span className="document-role" title={item.profileId ?? undefined}>{versions.join(' · ')}</span>}
      {item.compatibilityIssue && <span className="document-compatibility">
        {item.compatibilityIssue === 'UNSUPPORTED_PROFILE_VERSION'
          ? `Несовместимый профиль: v${item.profileVersion} (текущий v${item.currentProfileVersion})`
          : compatibilityLabels[item.compatibilityIssue] ?? 'Документ недоступен'}
      </span>}
      {canDelete && <Button className="document-catalog-delete" aria-label={`Удалить документ «${item.name}»`}
        disabled={busy} onClick={() => void remove()}>Удалить документ</Button>}
    </div>
  </li>;
}

export function createDocumentListView(host: HTMLElement, onDelete: DeleteDocument) {
  const root = createRoot(host);
  const render = (items: DocumentListItem[]) => {
    flushSync(() => root.render(<>{items.map(item =>
      <DocumentCard key={item.documentId} item={item} onDelete={onDelete} />)}</>));
  };
  return { render, clear: () => render([]) };
}
