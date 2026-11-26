export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function requiredRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new TypeError('Некорректный ответ сервера.');
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Некорректный ответ сервера.');
  return value;
}
export function array<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new TypeError('Некорректный ответ сервера.');
  return value.map(decode);
}
export function page<T>(value: unknown, decode: (item: unknown) => T): {items:T[];total:number} {
  const obj = requiredRecord(value);
  if (typeof obj.total !== 'number' || !Number.isSafeInteger(obj.total) || obj.total < 0) throw new TypeError('Некорректный ответ сервера.');
  return {items: array(obj.items, decode), total: obj.total};
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function aborted(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }
