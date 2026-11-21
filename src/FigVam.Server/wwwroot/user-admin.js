import { authHeaders, credentialsMode } from './auth-client.js';

export function createUserAdmin(element) {
  const section = element('user-admin');
  const feedback = element('user-admin-status');
  async function call(path, options = {}) {
    const response = await fetch(path, {
      ...options, cache: 'no-store', credentials: credentialsMode(), redirect: 'error',
      headers: { ...authHeaders('', options.method), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (!response.ok) throw new Error(response.status === 409
      ? 'Конфликт: пользователь уже существует или это последний администратор.'
      : response.status === 403 ? 'Недостаточно прав.' : 'Не удалось выполнить запрос.');
    return response.json();
  }
  async function refresh() {
    if (section.hidden) return;
    const { users } = await call('/api/users');
    const list = element('user-admin-list');
    list.replaceChildren();
    for (const user of users) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${user.email} (${user.name || 'Без имени'}) — ${user.isBound ? 'Google привязан' : 'Ожидает входа'}`;
      const access = document.createElement('label');
      access.textContent = ' Доступ ';
      const enabled = document.createElement('input');
      enabled.type = 'checkbox'; enabled.checked = user.enabled;
      const adminLabel = document.createElement('label');
      adminLabel.textContent = ' Admin ';
      const admin = document.createElement('input');
      admin.type = 'checkbox'; admin.checked = user.isAdmin;
      async function save() {
        enabled.disabled = admin.disabled = true;
        try {
          await call(`/api/users/${encodeURIComponent(user.id)}`, {
            method: 'PUT', body: JSON.stringify({ enabled: enabled.checked, admin: admin.checked })
          });
          feedback.textContent = 'Изменения сохранены.';
        } catch (error) { feedback.textContent = error.message; }
        finally { await refresh(); }
      }
      enabled.addEventListener('change', save);
      admin.addEventListener('change', save);
      access.append(enabled); adminLabel.append(admin);
      row.append(label, access, adminLabel); list.append(row);
    }
  }
  element('user-invite').addEventListener('submit', async event => {
    event.preventDefault();
    const email = element('user-email').value.trim();
    try {
      await call('/api/users', { method: 'POST', body: JSON.stringify({ email }) });
      element('user-email').value = '';
      feedback.textContent = 'Приглашение добавлено.';
      await refresh();
    } catch (error) { feedback.textContent = error.message; }
  });
  return {
    async show(isAdmin) {
      section.hidden = !isAdmin;
      if (isAdmin) try { await refresh(); } catch (error) { feedback.textContent = error.message; }
    },
    hide() { section.hidden = true; element('user-admin-list').replaceChildren(); }
  };
}
