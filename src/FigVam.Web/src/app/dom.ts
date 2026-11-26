/** The existing shell is mounted before editor services are created. Validate
 * legacy element lookups at that boundary instead of asserting DOM types. */
export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required editor element missing');
  return value;
}
type InputId = 'document-name' | 'rename-document-name' | 'import-file' | 'screen-width' | 'screen-height';
type FormId = 'create-form' | 'import-form' | 'screen-create' | 'document-rename' | 'token-create';
type ButtonId = 'delete-document' | 'delete-retry' | 'next' | 'previous' | 'retry' | 'disconnect' | 'page-refresh' | 'page-create' | 'refresh';
const inputIds: ReadonlySet<string> = new Set<InputId>(['document-name','rename-document-name','import-file','screen-width','screen-height']);
const formIds: ReadonlySet<string> = new Set<FormId>(['create-form','import-form','screen-create','document-rename','token-create']);
const buttonIds: ReadonlySet<string> = new Set<ButtonId>(['delete-document','delete-retry','next','previous','retry','disconnect','page-refresh','page-create','refresh']);
export function element(id: InputId): HTMLInputElement;
export function element(id: FormId): HTMLFormElement;
export function element(id: ButtonId): HTMLButtonElement;
export function element(id: string): HTMLElement;
export function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing editor element: ' + id);
  if (inputIds.has(id) && !(node instanceof HTMLInputElement)
    || formIds.has(id) && !(node instanceof HTMLFormElement)
    || buttonIds.has(id) && !(node instanceof HTMLButtonElement))
    throw new TypeError('Unexpected editor element type: ' + id);
  return node;
}
