export function createDatasets({ element, request, getContext, pageSize, startRequest, stopLive, startLive, readPages, run }) {
  let datasetGeneration = 0, datasetOffset = 0, datasetTotal = 0, datasetSelection = null;
  const datasetOperations = new Map();
  // Dataset reads follow the same authoritative revision as the editor.
  function resetDatasets() {
    datasetGeneration++; datasetOffset = datasetTotal = 0; datasetSelection = null;
    element('datasets-list').replaceChildren(); element('dataset-detail').hidden = true;
    element('dataset-edit').hidden = true; element('dataset-create').reset(); element('dataset-replace').reset();
    element('datasets-status').textContent = ''; element('datasets-error').textContent = '';
    element('datasets-retry').hidden = true; element('dataset-command-retry').hidden = true;
  }
  function datasetControls() {
    const op = datasetOperations.get(getContext().documentId);
    element('dataset-edit').inert = !!op;
    element('dataset-command-retry').hidden = !op || op.busy;
    element('datasets-previous').disabled = datasetOffset === 0;
    element('datasets-next').disabled = datasetOffset + pageSize >= datasetTotal;
    element('datasets-number').textContent = datasetTotal ? `${datasetOffset + 1}–${Math.min(datasetOffset + pageSize, datasetTotal)} из ${datasetTotal}` : '';
  }
  async function loadDatasets() {
    if (!getContext().documentId || !Number.isSafeInteger(getContext().revision)) return;
    const { documentId: doc, revision: atRevision, catalogRevision } = getContext(), current = ++datasetGeneration;
    const valid = () => current === datasetGeneration && doc === getContext().documentId && catalogRevision === getContext().catalogRevision;
    const base = `/api/v1/documents/${encodeURIComponent(doc)}/datasets`;
    element('datasets-status').textContent = 'Загрузка датасетов…'; element('datasets-error').textContent = '';
    element('datasets-retry').hidden = true; element('datasets-list').replaceChildren(); element('dataset-detail').hidden = true;
    try {
      const result = await request(`${base}?revision=${atRevision}&offset=${datasetOffset}&limit=${pageSize}`);
      if (!valid()) return;
      if (datasetOffset && !result.items.length) { datasetOffset = Math.max(0, datasetOffset - pageSize); return loadDatasets(); }
      datasetTotal = result.total; datasetControls();
      for (const item of result.items) {
        const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
        button.setAttribute('aria-pressed', String(item.id === datasetSelection));
        button.addEventListener('click', () => { datasetSelection = item.id; loadDatasets(); }); li.append(button); element('datasets-list').append(li);
      }
      element('datasets-status').textContent = result.total ? `Датасетов: ${result.total} · ревизия ${atRevision}` : 'Датасетов пока нет.';
      if (datasetSelection) {
        const [detail, fixture] = await Promise.all([request(`${base}/${encodeURIComponent(datasetSelection)}?revision=${atRevision}`), request(`${base}/${encodeURIComponent(datasetSelection)}/fixture?revision=${atRevision}`)]);
        if (!valid()) return;
        element('dataset-title').textContent = detail.dataset.name; element('dataset-fixture').textContent = fixture.fixtureJson;
        element('dataset-detail').hidden = false; element('dataset-replace').hidden = false; element('dataset-delete').hidden = false;
      } else { element('dataset-replace').hidden = true; element('dataset-delete').hidden = true; }
      if (datasetOperations.has(doc) && !datasetOperations.get(doc).busy) element('datasets-error').textContent = 'Результат операции неизвестен или обновление не завершено. Повторите операцию.';
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      element('datasets-status').textContent = ''; element('datasets-error').textContent = error.message; element('datasets-retry').hidden = false;
    }
  }
  async function datasetCommand(op) {
    const doc = getContext().documentId;
    if (!doc || !['Owner', 'Editor'].includes(getContext().documentRole) || op.busy) return;
    op.busy = true; datasetOperations.set(doc, op); datasetControls();
    element('datasets-error').textContent = ''; element('datasets-status').textContent = 'Сохранение датасета…';
    try {
      if (!op.accepted) {
        await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/${op.command}`, { method: 'POST', body: JSON.stringify(op.body) });
        op.accepted = true;
      }
      if (doc !== getContext().documentId || !getContext().token) return;
      stopLive(); const { signal, current } = startRequest();
      if (op.selection !== undefined) datasetSelection = op.selection;
      await readPages(signal);
      if (current !== getContext().generation || doc !== getContext().documentId || signal.aborted) return;
      datasetOperations.delete(doc); datasetControls(); element('datasets-status').textContent = 'Изменение сохранено.'; startLive();
    } catch (error) {
      if (!op.accepted && error.status && error.status < 500) datasetOperations.delete(doc);
      if (doc !== getContext().documentId || !getContext().token) return;
      if (error.code === 'REVISION_CONFLICT') {
        element('datasets-error').textContent = 'Документ изменился. Обновите датасеты перед повтором.';
        element('datasets-retry').hidden = false;
      } else if (error.code === 'DATASET_IN_USE') element('datasets-error').textContent = 'Датасет используется. Удалите ссылки перед удалением.';
      else if (datasetOperations.has(doc)) element('datasets-error').textContent = 'Результат операции неизвестен или обновление не завершено. Повторите операцию с тем же идентификатором.';
      else element('datasets-error').textContent = error.message;
      startLive();
    } finally { op.busy = false; if (doc === getContext().documentId) datasetControls(); }
  }
  function newDatasetCommand(command, body, selection) {
    if (datasetOperations.has(getContext().documentId)) return;
    datasetCommand({ command, body: { commandId: crypto.randomUUID(), ...body }, selection, busy: false, accepted: false });
  }
  element('dataset-create').addEventListener('submit', event => {
    event.preventDefault(); const csv = element('dataset-create-format').value === 'csv', id = crypto.randomUUID();
    newDatasetCommand(csv ? 'add-csv-dataset' : 'add-dataset', { datasetId: id, name: element('dataset-name').value, [csv ? 'csv' : 'fixtureJson']: element('dataset-create-content').value }, id);
  });
  element('dataset-replace').addEventListener('submit', event => {
    event.preventDefault(); const csv = element('dataset-replace-format').value === 'csv';
    newDatasetCommand(csv ? 'replace-dataset-fixture-from-csv' : 'replace-dataset-fixture', { datasetId: datasetSelection, expectedRevision: getContext().revision, [csv ? 'csv' : 'fixtureJson']: element('dataset-replace-content').value }, datasetSelection);
  });
  element('dataset-delete').addEventListener('click', () => {
    if (datasetSelection && confirm(`Удалить датасет «${element('dataset-title').textContent}»?`)) newDatasetCommand('delete-dataset', { datasetId: datasetSelection, expectedRevision: getContext().revision }, null);
  });
  element('dataset-command-retry').addEventListener('click', () => { const op = datasetOperations.get(getContext().documentId); if (op) datasetCommand(op); });
  element('datasets-previous').addEventListener('click', () => { datasetOffset = Math.max(0, datasetOffset - pageSize); loadDatasets(); });
  element('datasets-next').addEventListener('click', () => { datasetOffset += pageSize; loadDatasets(); });
  element('datasets-retry').addEventListener('click', () => { if (getContext().documentId) run(loadDatasets, signal => readPages(signal)); });

  return { reset: resetDatasets, load: loadDatasets };
}
