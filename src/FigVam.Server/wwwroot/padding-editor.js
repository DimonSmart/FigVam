const sides = [
  ['top', 'paddingTop', 'Сверху', 'Отступ сверху'],
  ['right', 'paddingRight', 'Справа', 'Отступ справа'],
  ['bottom', 'paddingBottom', 'Снизу', 'Отступ снизу'],
  ['left', 'paddingLeft', 'Слева', 'Отступ слева']
];

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
      const input = slot.querySelector('input[type=number]:not(:disabled)');
      const target = input && !input.closest('[hidden]') ? input :
        slot.querySelector('.token-value-link:not(:disabled)');
      target?.focus();
    });
    diagram.append(button);
  }
  grid.append(diagram);
  root.append(heading, grid);
  return root;
}

// Keep existing field nodes and their listeners, validation and drafts intact.
export function updatePaddingEditor(root, fields, reconcileChildren) {
  for (const [side, name, shortLabel, labelText] of sides) {
    const slot = root.querySelector('.padding-editor-field[data-side="' + side + '"]');
    const row = fields.get(name).row;
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

export function updateGapRow(root, field, reconcileChildren) {
  reconcileChildren(root, [root.querySelector('.padding-gap-icon'), field.row]);
}
