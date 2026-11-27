import { MousePointer2, Frame, Type, RectangleHorizontal, TextCursorInput, Image } from 'lucide-react';
import { Button } from '../../ui/Button';

const tools = [
  ['Frame', 'Контейнер', Frame],
  ['Text', 'Текст', Type],
  ['Button', 'Кнопка', RectangleHorizontal],
  ['TextInput', 'Поле ввода', TextCursorInput],
  ['Image', 'Изображение', Image],
] as const;
export type DrawingToolKind = typeof tools[number][0];

export function DrawingTools({ available, onSelect, onAdd }: {
  available: readonly string[];
  onSelect(): void;
  onAdd(kind: DrawingToolKind): void;
}) {
  return <>
    <span className="drawing-label">Инструменты</span>
    <Button type="button" className="drawing-tool selected" title="Выбор и перемещение"
      aria-label="Выбор и перемещение" onClick={onSelect}>
      <MousePointer2 size={18} strokeWidth={1.7} aria-hidden="true"/>
    </Button>
    {tools.map(([kind, label, Icon]) => <Button key={kind} type="button" className="drawing-tool"
      title={'Добавить: ' + label} aria-label={'Добавить ' + label.toLowerCase()}
      disabled={!available.includes(kind)} onClick={() => onAdd(kind)}>
      <Icon size={18} strokeWidth={1.7} aria-hidden="true"/>
    </Button>)}
  </>;
}
