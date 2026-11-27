import { createAuthContext, type AuthPolicy } from './auth-client.js';

export interface ApiClientOptions {
  auth?: AuthPolicy;
  getToken: () => string;
  getSessionEpoch?: () => number;
  getSessionSignal?: () => AbortSignal;
  onUnauthorized: () => void;
}

interface ErrorBody {
  code?: string;
  detail?: string;
  property?: string;
  diagnostics?: unknown;
}

const errors: Readonly<Partial<Record<number, string>>> = {
  400: 'Сервер отклонил запрос. Проверьте введённые значения.',
  403: 'Нет доступа к документу. Запросите права у владельца.',
  404: 'Документ не найден или больше недоступен.',
  409: 'Документ с таким идентификатором уже существует. Обновите список перед повторной попыткой.',
  429: 'Слишком много запросов. Повторите позже.',
};
const codes: Readonly<Partial<Record<string, string>>> = {
  UNSUPPORTED_PROFILE_VERSION: 'Версия профиля документа несовместима с текущей версией FigVam.',
  PROFILE_UNAVAILABLE: 'Профиль документа не установлен.',
  INVALID_PROFILE: 'Профиль документа некорректен.',
  REVISION_CONFLICT: 'Документ изменился. Обновите страницы и повторите действие.',
  PAGE_IN_USE: 'Страница используется другими объектами. Удалите ссылки на неё и её содержимое перед удалением.',
  PAGE_NOT_FOUND: 'Страница больше не существует. Обновите страницы.',
  PARENT_NOT_FOUND: 'Экран или слой больше не существует.',
  REVISION_UNAVAILABLE: 'Ревизия больше недоступна.',
  INVALID_PAGE: 'Не удалось сохранить страницу: проверьте имя и ограничения документа.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseError(value: unknown): ErrorBody {
  if (!isRecord(value)) return {};
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    property: typeof value.property === 'string' ? value.property : undefined,
    diagnostics: value.diagnostics,
  };
}

export class ApiError extends Error {
  readonly code: string | undefined;
  readonly detail: string | undefined;
  readonly property: string | undefined;
  readonly diagnostics: unknown;

  constructor(readonly status: number, body: ErrorBody) {
    const code = body.code;
    super((code && Object.hasOwn(codes, code) ? codes[code] : undefined)
      ?? errors[status] ?? 'Сервер не смог выполнить запрос. Повторите позже.');
    this.name = 'ApiError';
    this.code = code;
    this.detail = body.detail;
    this.property = body.property;
    this.diagnostics = body.diagnostics;
  }
}

type RequestArgs = [
  path: string,
  options?: RequestInit,
  signal?: AbortSignal | null,
  isCurrent?: () => boolean,
];

export interface ApiClient {
  (...args: RequestArgs): Promise<unknown>;
  readPng(...args: RequestArgs): Promise<Blob>;
  command?(...args: RequestArgs): Promise<unknown>;
}

export function createApiClient({ auth = createAuthContext(), getToken, getSessionEpoch, getSessionSignal, onUnauthorized }: ApiClientOptions): ApiClient {
  async function readResponse(
    path: string, options?: RequestInit, signal?: AbortSignal | null,
    isCurrent: () => boolean = () => true, retainCommandOutcome = false,
  ): Promise<{ response: Response; assertCurrent: () => void }> {
    const requestToken = getToken();
    const epoch = getSessionEpoch?.();
    const operationSignal = signal === undefined ? options?.signal : signal;
    const sessionSignal = getSessionSignal?.();
    const requestSignal = sessionSignal && operationSignal ? AbortSignal.any([sessionSignal, operationSignal]) : sessionSignal ?? operationSignal;
    const current = () => !requestSignal?.aborted && requestToken === getToken() && epoch === getSessionEpoch?.() && isCurrent();
    const assertCurrent = () => {
      if (!current())
        throw new DOMException('Cancelled', 'AbortError');
    };
    assertCurrent();
    const headers = new Headers(auth.authHeaders(requestToken, options?.method));
    if (options?.body) headers.set('Content-Type', 'application/json');
    new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(path, {
      ...options, signal: requestSignal, cache: 'no-store', credentials: auth.credentialsMode(), redirect: 'error', headers,
    });
    if (!retainCommandOutcome) assertCurrent();
    if (response.status === 401) {
      if (current()) onUnauthorized();
      if (retainCommandOutcome) throw new ApiError(401, {});
      throw new Error('Сессия завершена. Войдите повторно.');
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      if (!retainCommandOutcome) assertCurrent();
      throw new ApiError(response.status, parseError(body));
    }
    return { response, assertCurrent };
  }
  const request = async (...args: RequestArgs): Promise<unknown> => {
    const { response, assertCurrent } = await readResponse(...args);
    const value: unknown = await response.json();
    assertCurrent();
    return value;
  };
  request.command = async (path: string, options?: RequestInit, signal?: AbortSignal | null, isCurrent?: () => boolean): Promise<unknown> => {
    const { response } = await readResponse(path, options, signal, isCurrent, true);
    return response.json();
  };
  request.readPng = async (...args: RequestArgs): Promise<Blob> => {
    const { response, assertCurrent } = await readResponse(...args);
    if (response.headers.get('Content-Type') !== 'image/png')
      throw new TypeError('Получен неподдерживаемый формат изображения.');
    const png = await response.blob();
    assertCurrent();
    return png;
  };
  return request;
}

export { parseDocumentList } from './document-list.js';
