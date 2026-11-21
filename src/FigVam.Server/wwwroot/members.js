import { credentialsMode, isGoogleMode } from './auth-client.js';
export function createMembers({ element, request, findRole, openDocument, loadList, message, stopLive, startLive, workspace }) {
  let memberController = null;
  function reset() {
    memberController?.abort(); memberController = null;
    element('member-management').hidden = true;
    element('member-form').reset();
    element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = false);
    element('member-status').textContent = element('member-error').textContent = '';
  }
  async function changeMember(remove) {
    if (memberController || workspace.documentRole !== 'Owner' || !workspace.token || !workspace.documentId || element('editor-view').hidden) return;
    const memberId = element('member-id').value;
    const role = element('member-role').value;
    element('member-status').textContent = element('member-error').textContent = '';
    if (!memberId.trim() || memberId.length > 256 || (remove && memberId.includes('/'))) {
      element('member-error').textContent = 'Укажите корректный ID участника (от 1 до 256 символов; для удаления без /).';
      element('member-id').focus(); return;
    }
    if (!remove && !['Owner', 'Editor', 'Viewer'].includes(role)) {
      element('member-error').textContent = 'Выберите допустимую роль.'; return;
    }
    if (remove && !confirm(`Удалить участника «${memberId}» из документа?`)) return;
    const controller = new AbortController(), id = workspace.documentId, epoch = workspace.navigationEpoch, requestToken = workspace.token;
    memberController = controller;
    stopLive();
    const active = () => memberController === controller && !controller.signal.aborted && epoch === workspace.navigationEpoch && workspace.token === requestToken && id === workspace.documentId && !element('editor-view').hidden;
    element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = true);
    element('member-status').textContent = 'Сохранение…';
    let accepted = false;
    try {
      const path = `/api/v1/documents/${encodeURIComponent(id)}/members${remove ? `/${encodeURIComponent(memberId)}` : ''}`;
      const result = await request(path, remove ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ memberId, role }) }, controller.signal);
      if (!active()) return;
      if (result.code !== 'ACCEPTED' || result.documentId?.toLowerCase() !== id.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      accepted = true;
      const currentRole = await findRole(id, controller.signal);
      if (!active()) return;
      const success = remove ? 'Участник удалён.' : `Роль участника назначена: ${role}.`;
      if (currentRole !== 'Owner') {
        if (currentRole) {
          const reopening = openDocument(id), nextEpoch = workspace.navigationEpoch;
          await reopening;
          if (nextEpoch === workspace.navigationEpoch && workspace.token && workspace.documentId === id && !element('editor-view').hidden) message(success + ' Ваши права изменились.');
        } else {
          const loading = loadList(), nextEpoch = workspace.navigationEpoch;
          await loading;
          if (nextEpoch === workspace.navigationEpoch && workspace.token) message(success + ' Доступ к документу больше не предоставлен.');
        }
        return;
      }
      element('member-status').textContent = success;
    } catch (error) {
      if (!active() || error.name === 'AbortError') return;
      if (accepted || error instanceof TypeError) {
        const loading = loadList(), nextEpoch = workspace.navigationEpoch;
        await loading;
        if (nextEpoch === workspace.navigationEpoch && workspace.token) message('', accepted
          ? 'Изменение сохранено, но не удалось проверить ваши права. Откройте документ снова.'
          : 'Не удалось подтвердить результат. Проверьте доступ и повторите запрос при необходимости.');
        return;
      }
      element('member-status').textContent = '';
      element('member-error').textContent = error.code === 'LAST_OWNER' ? 'Нельзя удалить последнего Owner или изменить его роль.'
        : error.status === 400 || error.code === 'INVALID_MEMBER' ? 'Некорректный ID участника или роль. Проверьте введённые данные.'
        : error.status === 403 ? 'Нет прав управлять участниками документа.'
        : error instanceof TypeError ? 'Не удалось подтвердить результат. Проверьте доступ и повторите запрос при необходимости.' : error.message;
    } finally {
      if (active()) {
        memberController = null;
        element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = false);
        startLive();
      }
    }
  }
  element('member-form').addEventListener('submit', event => { event.preventDefault(); changeMember(false); });
  element('member-remove').addEventListener('click', () => changeMember(true));

  function prepare(role) {
    element('member-management').hidden = role !== 'Owner';
  }

  return { reset, prepare };
}
