import { authHeaders, credentialsMode } from './auth-client.js';

export function createApiClient({ getToken, onUnauthorized }) {
  async function readResponse(path, options, signal, isCurrent = () => true) {
    const requestToken = getToken();
    const response = await fetch(path, {
      ...options, signal, cache: 'no-store', credentials: credentialsMode(), redirect: 'error',
      headers: { ...authHeaders(requestToken, options?.method), ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers }
    });
    if (signal?.aborted || requestToken !== getToken() || !isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) {
      onUnauthorized();
      throw new Error('Сессия завершена. Войдите повторно.');
    }
    if (!response.ok) {
      const errors = {
        400: 'Сервер отклонил запрос. Проверьте введённые значения.',
        403: 'Нет доступа к документу. Запросите права у владельца.',
        404: 'Документ не найден или больше недоступен.',
        409: 'Документ с таким идентификатором уже существует. Обновите список перед повторной попыткой.',
        429: 'Слишком много запросов. Повторите позже.'
      };
      const body = await response.json().catch(() => ({}));
      if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
      const codes = { REVISION_CONFLICT: 'Документ изменился. Обновите страницы и повторите действие.', PAGE_IN_USE: 'Страница используется другими объектами. Удалите ссылки на неё и её содержимое перед удалением.', PAGE_NOT_FOUND: 'Страница больше не существует. Обновите страницы.', PARENT_NOT_FOUND: 'Экран или слой больше не существует.', REVISION_UNAVAILABLE: 'Ревизия больше недоступна.', INVALID_PAGE: 'Не удалось сохранить страницу: проверьте имя и ограничения документа.' };
      const error = new Error(codes[body.code] ?? errors[response.status] ?? 'Сервер не смог выполнить запрос. Повторите позже.');
      error.status = response.status; error.code = body.code;
      error.detail = body.detail; error.property = body.property;
      throw error;
    }
    return response;
  }
  async function request(...args) { return (await readResponse(...args)).json(); }
  request.readPng = async (...args) => {
    const response = await readResponse(...args);
    if (response.headers.get('Content-Type') !== 'image/png') throw new TypeError('Получен неподдерживаемый формат изображения.');
    return response.blob();
  };
  return request;
}
