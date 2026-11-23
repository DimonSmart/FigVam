import { normalizedTokenType, resolveTokenValue, tokenValueText, tokenColorHex } from './token-resolution.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

// A reusable property control. It exposes the same read/write/validate contract as
// literal controls so the inspector and the creation palette share draft handling.
export function createTokenValueControl(name, definition, model, initial, direct, label) {
  const literalType = definition.type.toLowerCase();
  const theme = 'Light'; // Design and inspector always display the Light theme.
  const compatible = [...model.tokens.values()].filter(
    token => normalizedTokenType(token.type) === normalizedTokenType(definition.tokenType));
  const root = el('div', 'token-value-layout');
  const caption = el('span', 'token-value-label', label);
  const editor = el('div', 'token-value-editor');
  const directHost = el('div', 'token-value-direct');
  if (definition.type === 'Number') {
    const input = direct.inputs[0];
    input.setAttribute('aria-label', label);
    directHost.append(input);
  } else {
    directHost.append(...direct.content);
  }

  const referenceHost = el('div', 'token-value-reference');
  const nameText = el('span', 'token-value-name');
  const resolvedText = el('span', 'token-value-resolved');
  const swatch = el('span', 'token-value-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  referenceHost.append(swatch, nameText, resolvedText);
  const link = el('button', 'token-value-link', '🔗');
  link.type = 'button';
  link.setAttribute('aria-haspopup', 'dialog');
  link.setAttribute('aria-expanded', 'false');
  const popover = el('div', 'token-value-popover');
  popover.hidden = true;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', label + ' — дизайн-токены');
  const search = el('input', 'token-value-search');
  search.type = 'search';
  search.placeholder = 'Поиск токена';
  search.setAttribute('aria-label', 'Поиск токена');
  const choices = el('div', 'token-value-choices');
  const unlink = el('button', 'token-value-unlink', 'Отвязать токен');
  unlink.type = 'button';
  popover.append(search, choices, unlink);
  editor.append(directHost, referenceHost, link);
  root.append(caption, editor, popover);

  let source = literalType, tokenId = '', readOnly = false;
  const resolved = () => resolveTokenValue({ type: 'token', tokenId }, model.tokens, theme, definition.tokenType);

  function updateView() {
    const linked = source === 'token';
    root.classList.toggle('is-linked', linked);
    directHost.hidden = linked;
    referenceHost.hidden = !linked;
    link.setAttribute('aria-label', readOnly ? 'Просмотреть дизайн-токен' :
      linked ? 'Изменить привязку токена' : 'Привязать токен');
    link.setAttribute('aria-pressed', String(linked));
    if (!linked) { root.classList.remove('is-invalid'); return; }
    const item = model.tokens.get(tokenId);
    const result = resolved();
    nameText.textContent = item?.name ?? 'Удалённый токен · ' + tokenId.slice(0, 8);
    resolvedText.textContent = (result.error ?? tokenValueText(result.value)) + ' · ' + theme;
    resolvedText.classList.toggle('is-invalid', Boolean(result.error));
    swatch.hidden = result.value?.type !== 'color' || Boolean(result.error);
    if (!swatch.hidden) swatch.style.backgroundColor = 'rgba(' +
      [result.value.red, result.value.green, result.value.blue, result.value.alpha / 255].join(', ') + ')';
    root.classList.toggle('is-invalid', Boolean(result.error));
    referenceHost.title = result.error ?? (nameText.textContent + ' · ' + tokenValueText(result.value) + ' · ' + theme);
  }

  function close(restoreFocus = false) {
    if (popover.hidden) return;
    popover.hidden = true;
    link.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    if (restoreFocus) link.focus();
  }
  function outside(event) {
    if (!root.contains(event.target)) close();
  }
  function escape(event) {
    if (event.key === 'Escape' && !popover.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
  function fireChange() {
    updateView();
    link.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function renderChoices() {
    choices.replaceChildren();
    const filter = search.value.trim().toLocaleLowerCase();
    const options = compatible.filter(token => token.name.toLocaleLowerCase().includes(filter));
    if (!options.length) choices.append(el('p', 'token-value-empty',
      compatible.length ? 'По запросу токены не найдены.' : 'Нет совместимых токенов.'));
    for (const token of options) {
      const option = el('button', 'token-value-option');
      option.type = 'button';
      const state = resolveTokenValue({ type: 'token', tokenId: token.id }, model.tokens, theme, definition.tokenType);
      const text = el('span', 'token-value-option-name', token.name);
      const preview = el('small', 'token-value-option-preview', state.error ?? tokenValueText(state.value));
      option.append(text, preview);
      option.disabled = readOnly;
      option.setAttribute('aria-pressed', String(source === 'token' && token.id === tokenId));
      option.addEventListener('click', () => {
        if (readOnly) return;
        source = 'token';
        tokenId = token.id;
        close(true);
        fireChange();
      });
      choices.append(option);
    }
    unlink.hidden = source !== 'token' || readOnly;
  }
  function open() {
    if (!popover.hidden) { close(true); return; }
    search.value = '';
    renderChoices();
    popover.hidden = false;
    link.setAttribute('aria-expanded', 'true');
    const rect = link.getBoundingClientRect();
    const width = Math.min(270, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + 8 + 260 < window.innerHeight ?
      rect.bottom + 5 : Math.max(8, rect.top - 265);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    popover.style.width = width + 'px';
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    search.focus();
  }

  link.addEventListener('click', open);
  search.addEventListener('input', renderChoices);
  unlink.addEventListener('click', () => {
    if (readOnly || source !== 'token') return;
    const result = resolved();
    if (result.error) {
      // Do not silently turn an unresolved reference into the default literal.
      direct.write(definition.type === 'Number' ? '' : ['', '255']);
    } else if (definition.type === 'Color') {
      direct.write([tokenColorHex(result.value), String(result.value.alpha)]);
    } else {
      direct.write(String(result.value.type === 'geometry' ? result.value.radius : result.value.value));
    }
    source = literalType;
    tokenId = '';
    close(true);
    fireChange();
  });

  return {
    content: [root],
    inputs: [...direct.inputs, link],
    initial: [initial?.type === 'token' ? 'token' : literalType, direct.initial, initial?.tokenId ?? ''],
    read: () => [source, direct.read(), tokenId],
    write([mode, literal, id]) {
      close();
      source = mode === 'token' ? 'token' : literalType;
      tokenId = id ?? '';
      direct.write(literal);
      updateView();
    },
    setDisabled(disabled) {
      readOnly = disabled;
      for (const input of direct.inputs) input.disabled = disabled;
      // Viewer may inspect the token without changing it.
      link.disabled = false;
      updateView();
      if (!popover.hidden) renderChoices();
    },
    validate() {
      if (source !== 'token') return direct.validate();
      const result = resolved();
      if (result.error) return { input: link, error: result.error };
      return { value: { type: 'token', tokenId } };
    }
  };
}
