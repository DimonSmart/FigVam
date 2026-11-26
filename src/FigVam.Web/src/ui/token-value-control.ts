import type { ResolvableValue, TokenMap } from '../core/tokens/token-model';
import type { ControlDefinition, PropertyControl, RawValue, TokenControlOptions } from './property-control-contract';
import { rawArray, rawText } from './property-control-contract';
import { compatibleToken, resolvePropertyToken, tokenValueText, tokenColorHex } from '../core/tokens/token-resolution';

const el = <K extends keyof HTMLElementTagNameMap>(tag:K, cls?:string, text?:string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

// A reusable property control. It exposes the same read/write/validate contract as
// literal controls so the inspector and the creation palette share draft handling.
export function createTokenValueControl(_name:string, definition:ControlDefinition, model:{tokens:TokenMap}, initial:ResolvableValue|null|undefined, direct:PropertyControl, label:string, displayLabel=label, options:TokenControlOptions={}):PropertyControl {
  const literalType = definition.type.toLowerCase();
  const theme = options.theme ?? 'Light';
  const getCompatible = options.getCompatible ?? (() => [...model.tokens.values()].filter(token => compatibleToken(token, definition)));
  const resolve = (id:string) => options.resolve ? options.resolve(id) : resolvePropertyToken({ type: 'token', tokenId: id }, model.tokens, theme, definition);
  const root = el('div', 'token-value-layout');
  if (definition.type === 'Shadow') root.classList.add('token-value-layout--shadow');
  const caption = el('span', 'token-value-label', displayLabel);
  if (displayLabel !== label) caption.title = label;
  const editor = el('div', 'token-value-editor');
  const directHost = el('div', 'token-value-direct');
  if (definition.type === 'Number' && !options.customDirect) {
    const input = direct.inputs[0];
    if(!input)throw new Error('Missing literal input');
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
  const resolved = () => resolve(tokenId);

  function updateView() {
    const linked = source === 'token';
    root.classList.toggle('is-linked', linked);
    directHost.hidden = linked;
    referenceHost.hidden = !linked;
    link.setAttribute('aria-label', readOnly ? 'Просмотреть дизайн-токен' :
      linked ? 'Изменить привязку токена' : 'Привязать токен');
    link.setAttribute('aria-pressed', String(linked));
    if (!linked) {
      root.classList.remove('is-invalid');
      nameText.textContent = resolvedText.textContent = '';
      referenceHost.removeAttribute('title');
      return;
    }
    const item = (options.getToken ? options.getToken(tokenId) : model.tokens.get(tokenId));
    const result = resolved();
    nameText.textContent = item?.name ?? 'Удалённый токен · ' + tokenId.slice(0, 8);
    resolvedText.textContent = (result.error ?? tokenValueText(result.value)) + ' · ' + theme;
    resolvedText.classList.toggle('is-invalid', Boolean(result.error));
    swatch.hidden = result.value?.type !== 'color' || Boolean(result.error);
    if (!swatch.hidden && result.value?.type==='color') swatch.style.backgroundColor = 'rgba(' +
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
  function outside(event:PointerEvent) {
    if (!(event.target instanceof Node) || !root.contains(event.target)) close();
  }
  function escape(event:KeyboardEvent) {
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
    const compatible = getCompatible();
    const matches = compatible.filter(token => token.name.toLocaleLowerCase().includes(filter));
    if (!matches.length) choices.append(el('p', 'token-value-empty',
      compatible.length ? 'По запросу токены не найдены.' : 'Нет совместимых токенов.'));
    for (const token of matches) {
      const option = el('button', 'token-value-option');
      option.type = 'button';
      const state = resolve(token.id);
      const text = el('span', 'token-value-option-name', token.name);
      const preview = el('small', 'token-value-option-preview', state.error ?? tokenValueText(state.value));
      option.append(text, preview);
      const invalid = Boolean(options.validateChoices && state.error);
      option.dataset.invalid = String(invalid);
      option.disabled = readOnly || invalid;
      option.setAttribute('aria-pressed', String(source === 'token' && token.id === tokenId));
      option.addEventListener('click', () => {
        if (readOnly || invalid) return;
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
  search.addEventListener('input', event => {
    event.stopPropagation(); // Searching must not change the property's draft.
    renderChoices();
  });
  search.addEventListener('change', event => event.stopPropagation());
  unlink.addEventListener('click', () => {
    if (readOnly || source !== 'token') return;
    const result = resolved();
    if (options.writeResolved) {
      options.writeResolved(result);
      source = literalType; tokenId = ''; close(true); fireChange(); return;
    }
    if (result.error || !result.value) {
      // Unresolved references cannot supply a literal. Switch to an empty, invalid
      // draft so the user explicitly enters a value before saving the property.
      if (definition.type === 'Color') direct.write(['', '255']);
      else if (definition.numericFontWeight) direct.write(['Custom', '']);
      else direct.write('');
      source = literalType;
      tokenId = '';
      close(true);
      fireChange();
      return;
    }
    if (definition.type === 'Color' && result.value.type==='color') {
      direct.write([tokenColorHex(result.value), String(result.value.alpha)]);
    } else if (definition.numericFontWeight) {
      direct.write(['Custom', String('value' in result.value ? result.value.value : '')]);
    } else if (definition.type === 'String') {
      direct.write('value' in result.value && typeof result.value.value==='string' ? result.value.value : '');
    } else {
      direct.write(String(result.value.type === 'geometry' ? result.value.radius : 'value' in result.value ? result.value.value : ''));
    }
    source = literalType;
    tokenId = '';
    close(true);
    fireChange();
  });

  return {
    content: [root],
    inputs: [...direct.inputs, link],
    initial: [initial?.type === 'token' ? 'token' : literalType, direct.initial, initial?.type==='token' ? initial.tokenId : ''],
    read: () => [source, direct.read(), tokenId],
    write(value:RawValue) {
      const [mode,literal,id]=rawArray(value);
      close();
      source = mode === 'token' ? 'token' : literalType;
      tokenId = rawText(id);
      direct.write(literal??null);
      updateView();
    },
    setDisabled(disabled:boolean) {
      const wasDisabled = readOnly;
      readOnly = disabled;
      if (direct.setDisabled) direct.setDisabled(disabled);
      else for (const input of direct.inputs) input.disabled = disabled;
      // Viewer may inspect the token without changing it.
      link.disabled = false;
      updateView();
      // Keep the option nodes stable across search blur and focus changes:
      // replacing them on pointerdown prevents their click handlers from firing.
      if (wasDisabled !== readOnly && !popover.hidden) {
        for (const option of choices.querySelectorAll('button')) option.disabled = readOnly || option.dataset.invalid === 'true';
        unlink.hidden = source !== 'token' || readOnly;
      }
    },
    refresh() { direct.refresh?.(); updateView(); },
    dispose() { close(); direct.dispose?.(); },
    validate() {
      if (source !== 'token') return direct.validate();
      const result = resolved();
      if (result.error) return { input: link, error: result.error };
      return { value: { type: 'token', tokenId } };
    }
  };
}
