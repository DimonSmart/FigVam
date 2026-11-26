export interface LayerCaptionSource { name?: string | null; kind: string; properties?: Record<string, { type?: string; value?: unknown } | undefined> | null }
export interface LayerCaption { text: string; source: 'explicit' | 'inferred' | 'missing'; origin: string }

// Derived layer captions are for display only and never change the saved node name.
export function layerDisplayName(item: LayerCaptionSource): LayerCaption {
  const explicit = item.name?.trim();
  if (explicit) return { text: explicit, source: 'explicit', origin: 'Имя слоя' };

  const props = item.properties ?? {};
  function excerpt(key: string) {
    const value = props[key];
    if (value?.type !== 'string' || typeof value.value !== 'string') return null;
    const line = value.value.split(/\r\n|\r|\n/, 1)[0]?.replace(/\s+/g, ' ').trim();
    if (!line) return null;
    return line.length > 48 ? line.slice(0, 47).trimEnd() + '…' : line;
  }
  const keys: Record<string, readonly (readonly [string, string])[] | undefined> = {
    Text: [['text', 'Текст элемента']],
    Button: [['text', 'Текст кнопки']],
    TextInput: [
      ['placeholder', 'Подсказка поля'],
      ...(props.inputType?.value === 'Password' ? [] : [['value', 'Значение поля'] as const])
    ],
    Image: [['altText', 'Альтернативный текст']]
  };
  for (const [key, origin] of keys[item.kind] ?? []) {
    const text = excerpt(key);
    if (text) return { text, source: 'inferred', origin };
  }
  return { text: 'Без имени', source: 'missing', origin: 'Имя слоя не задано' };
}

