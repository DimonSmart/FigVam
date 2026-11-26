export function bindInlineRename(form, input, cancel, isActive = () => true) {
  input.addEventListener('keydown', event => {
    if (event.isComposing || !isActive()) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault(); form.requestSubmit();
    }
  });
  input.addEventListener('blur', () => {
    if (isActive() && input.isConnected && !input.disabled) form.requestSubmit();
  });
}
