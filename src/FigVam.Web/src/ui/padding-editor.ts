const sides = [
  ['top', 'paddingTop', 'Сверху', 'Отступ сверху'],
  ['right', 'paddingRight', 'Справа', 'Отступ справа'],
  ['bottom', 'paddingBottom', 'Снизу', 'Отступ снизу'],
  ['left', 'paddingLeft', 'Слева', 'Отступ слева']
] as const;

type PaddingProperty = typeof sides[number][1];
interface Field { row: HTMLElement }
type Reconcile = (host: HTMLElement, children: HTMLElement[]) => void;

export const paddingProperties = sides.map(([, name]) => name);

export function createPaddingEditor() {
  const root = document.createElement('section');
  root.className = 'padding-editor';
  root.setAttribute('aria-label', 'Внутренние отступы');
  const heading = document.createElement('strong');
  heading.className = 'padding-editor-heading';
  heading.textContent = 'Отступы';
  const grid = document.createElement('div');
  grid.className = 'padding-editor-grid';
  const diagram = document.createElement('div');
  diagram.className = 'padding-editor-diagram';
  const content = document.createElement('span');
  content.className = 'padding-editor-content';
  content.setAttribute('aria-hidden', 'true');
  diagram.append(content);
  for (const [side, , , label] of sides) {
    const slot = document.createElement('div');
    slot.className = 'padding-editor-field';
    slot.dataset.side = side;
    grid.append(slot);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'padding-editor-side';
    button.dataset.side = side;
    button.title = label;
    button.setAttribute('aria-label', 'Перейти к полю: ' + label);
    button.addEventListener('click', () => {
      const linked = slot.querySelector('.token-value-layout.is-linked');
      const input = slot.querySelector<HTMLInputElement>('input[type=number]:not(:disabled)');
      const target = !linked && input && !input.closest('[hidden]') ? input :
        slot.querySelector<HTMLElement>('.token-value-link:not(:disabled)');
      target?.focus({ preventScroll: true });
    });
    diagram.append(button);
  }
  grid.append(diagram);
  root.append(heading, grid);
  return root;
}

// Keep existing field nodes and their listeners, validation and drafts intact.
export function updatePaddingEditor(root: HTMLElement, fields: ReadonlyMap<PaddingProperty, Field>, reconcileChildren: Reconcile) {
  for (const [side, name, shortLabel, labelText] of sides) {
    const slot = root.querySelector<HTMLElement>('.padding-editor-field[data-side="' + side + '"]');
    const row = fields.get(name)?.row;
    if (!slot || !row) throw new Error('Missing padding field: ' + name);
    const caption = row.querySelector('.token-value-label');
    if (caption) caption.textContent = shortLabel;
    else {
      const label = row.querySelector('label');
      if (label?.firstChild?.nodeType === Node.TEXT_NODE) {
        const input = label.querySelector('input');
        input?.setAttribute('aria-label', labelText);
        label.firstChild.textContent = shortLabel;
      }
    }
    reconcileChildren(slot, [row]);
  }
}

export function createGapRow() {
  const root = document.createElement('div');
  root.className = 'padding-gap-row';
  const icon = document.createElement('span');
  icon.className = 'padding-gap-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(document.createElement('i'), document.createElement('i'));
  root.append(icon);
  return root;
}

export function updateGapRow(root: HTMLElement, field: Field, reconcileChildren: Reconcile) {
  const icon = root.querySelector<HTMLElement>('.padding-gap-icon');
  if (!icon) throw new Error('Missing gap icon');
  reconcileChildren(root, [icon, field.row]);
}
