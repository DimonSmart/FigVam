export function createPresence({ element, getContext, toViewportPoint }) {
  let presenceController = null, presenceTimer = null, presenceParticipants = [], presenceCursor = null, presenceCursorScreen = null, presenceLastRead = 0;
  function stop() {
    presenceController?.abort(); presenceController = null; clearTimeout(presenceTimer); presenceTimer = null;
    presenceParticipants = []; presenceCursor = presenceCursorScreen = null; presenceLastRead = 0;
    element('presence-list').replaceChildren(); element('presence-markers').replaceChildren(); element('presence-status').textContent = '';
  }
  function render() {
    const list = element('presence-list'), markers = element('presence-markers');
    list.replaceChildren(); markers.replaceChildren();
    for (const participant of presenceParticipants) {
      const li = document.createElement('li');
      const cursor = participant.cursor ? `курсор: ${participant.cursor.x}, ${participant.cursor.y}` : 'курсор недоступен';
      li.textContent = `${participant.name} · цвет ${participant.color} · экран: ${participant.screenId || 'не выбран'} · выбранные ID: ${participant.selectedIds.length ? participant.selectedIds.join(', ') : 'нет'} · ${cursor}`;
      list.append(li);
      if (participant.screenId === getContext().selectedScreen && participant.cursor && getContext().selectedScreen) {
        const { x, y } = toViewportPoint(participant.cursor);
        const area = element('viewport');
        if (x >= 0 && y >= 0 && x < area.clientWidth && y < area.clientHeight) {
          const marker = document.createElement('span'); marker.className = 'presence-marker'; marker.textContent = `◆ ${participant.name}`;
          marker.style.left = `${x}px`; marker.style.top = `${y}px`; marker.style.borderColor = participant.color; markers.append(marker);
        }
      }
    }
  }
  function start() {
    const { token, documentId, navigationEpoch } = getContext();
    if (presenceController || !token || !documentId || element('editor-view').hidden) return;
    const controller = new AbortController(), doc = documentId, requestToken = token, epoch = navigationEpoch;
    presenceController = controller;
    const active = () => {
      const context = getContext();
      return presenceController === controller && !controller.signal.aborted && doc === context.documentId && context.token === requestToken && epoch === context.navigationEpoch && !element('editor-view').hidden;
    };
    const path = `/api/v1/documents/${encodeURIComponent(doc)}/presence`;
    async function exchange(method, body) {
      const response = await fetch(path, { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]), cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${requestToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!active()) throw new DOMException('Cancelled', 'AbortError');
      if (!response.ok) { const error = new Error('Presence unavailable'); error.status = response.status; throw error; }
      return response.json();
    }
    async function cycle() {
      if (!active()) return;
      try {
        const name = element('presence-name').value.trim().slice(0, 128) || 'Участник';
        const { selectedLayer, selectedScreen } = getContext();
        const body = { name, color: element('presence-color').value, cursor: presenceCursorScreen === selectedScreen ? presenceCursor : null, selectedIds: selectedLayer ? [selectedLayer.id] : [], screenId: selectedScreen };
        await exchange('PUT', body);
        const result = await exchange('GET');
        if (!active()) return;
        if (result.code !== 'PRESENCE' || !Array.isArray(result.participants) || result.participants.some(p => typeof p.name !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color) || !Array.isArray(p.selectedIds) || (p.cursor && (!Number.isFinite(p.cursor.x) || !Number.isFinite(p.cursor.y))))) throw new Error('Invalid presence');
        presenceParticipants = result.participants; presenceLastRead = Date.now(); render();
        element('presence-status').textContent = presenceParticipants.length ? 'Присутствующие участники обновлены.' : 'Сейчас участников нет.';
      } catch (error) {
        if (!active() || error.name === 'AbortError') return;
        if ([401, 403, 404].includes(error.status)) { presenceParticipants = []; render(); element('presence-status').textContent = 'Присутствие недоступно: доступ к документу потерян.'; return; }
        if (Date.now() - presenceLastRead >= 60000) { presenceParticipants = []; render(); }
        element('presence-status').textContent = 'Не удалось обновить присутствие. Повторная попытка автоматически.';
      }
      if (active()) presenceTimer = setTimeout(cycle, 10000);
    }
    element('presence-status').textContent = 'Загрузка участников…'; cycle();
  }

  function setCursor(cursor, screen) { presenceCursor = cursor; presenceCursorScreen = screen; }
  return { start, stop, render, setCursor };
}
