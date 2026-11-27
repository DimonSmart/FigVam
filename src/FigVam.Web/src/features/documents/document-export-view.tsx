import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { StatusMessage, InlineError } from '../../ui/Feedback';

export type ExportFormat = 'document.json' | 'container.figvam';
function ExportView({ access, disabled, status, error, download }: { access: string; disabled: boolean; status: string; error: string; download(format: ExportFormat): void }) {
  return <section aria-labelledby="export-title">
    <h2 id="export-title">Экспорт документа</h2>
    <p id="export-access">{access}</p>
    <Button id="export-json" disabled={disabled} onClick={() => download('document.json')}>Скачать document.json</Button>
    <Button id="export-container" disabled={disabled} onClick={() => download('container.figvam')}>Скачать container.figvam</Button>
    <StatusMessage id="export-status">{status}</StatusMessage>
    <InlineError id="export-error">{error}</InlineError>
  </section>;
}
export function createExportModel() { return createViewModel(ExportView); }
