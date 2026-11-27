import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createViewModel } from '../../app/view-model';
import { flushSync } from 'react-dom';
import { Check, X, Ellipsis } from 'lucide-react';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import { IconButton } from '../../ui/IconButton';
import type { PageItem, ScreenItem } from '../../api/document-queries';

export type NavigatorKind = 'page' | 'screen';
export interface RenameDraft { id: string; value: string }
interface RowAction { label: string; accessibleLabel: string; destructive?: boolean; run(): void }
interface NavigatorState {
  pages: PageItem[]; screens: ScreenItem[]; selectedPage: string | null; selectedScreen: string | null;
  pageExpanded: boolean; screensOffset: number; canEdit: boolean;
  editingPageName: RenameDraft | null; editingScreenName: RenameDraft | null;
}
interface NavigatorActions {
  isBusy(): boolean;
  selectPage(id: string): void; selectScreen(id: string): void;
  startRename(kind: NavigatorKind, id: string, name: string): void;
  changeDraft(kind: NavigatorKind, value: string): void;
  discardRename(kind: NavigatorKind, id: string): void;
  saveRename(kind: NavigatorKind, id: string, previousName: string, name: string): void;
  deletePage(item: PageItem): void; duplicateScreen(item: ScreenItem): void;
}

function RenameForm({ kind, draft, name, actions }: {kind: NavigatorKind; draft: RenameDraft; name: string; actions: NavigatorActions}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(draft.value);
  const noun = kind === 'page' ? 'страницы' : 'экрана';
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  const discard = () => actions.discardRename(kind, draft.id);
  return <form className="navigator-rename-form" onSubmit={event => {
    event.preventDefault();
    if (actions.isBusy() || !input.current) return;
    const newName = value.trim();
    if (!newName || /[\u0000-\u001f\u007f-\u009f]/.test(newName)) {
      input.current.setCustomValidity('Укажите непустое имя без управляющих символов.');
      input.current.reportValidity();
      return;
    }
    actions.saveRename(kind, draft.id, name, newName);
  }}>
    <TextInput ref={input} id={kind + '-name-input'} type="text" required maxLength={256} autoComplete="off"
      aria-label={'Имя ' + noun} value={value} onChange={event => {
        const next = event.currentTarget.value;
        event.currentTarget.setCustomValidity(''); setValue(next); actions.changeDraft(kind, next);
      }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); discard(); }
      }}/>
    <IconButton type="submit" className="navigator-rename-confirm" title="Сохранить название"
      label={'Сохранить название ' + noun} icon={Check} iconSize={14}/>
    <IconButton className="navigator-rename-cancel" title="Отменить переименование"
      label={'Отменить переименование ' + noun} onClick={discard} icon={X} iconSize={14}/>
  </form>;
}

function NavigatorRow({ kind, id, name, canEdit, selected, expanded, label, draft, actions, menuActions, children }: {
  kind: NavigatorKind; id: string; name: string; canEdit: boolean; selected: boolean;
  expanded?: boolean; label: string; draft: RenameDraft | null; actions: NavigatorActions;
  menuActions: RowAction[]; children?: ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const noun = kind === 'page' ? 'страницу' : 'экран';
  const triggerLabel = kind === 'page' ? 'Действия со страницей' : 'Действия с экраном';
  function position() {
    const m = menu.current, t = trigger.current, b = body.current;
    if (!m?.open || !m.isConnected || !t || !b) return;
    if (!b.matches(':popover-open')) b.showPopover();
    const anchor = t.getBoundingClientRect(), margin = 8, gap = 4;
    const below = Math.max(0, innerHeight - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    b.style.maxHeight = '';
    const openAbove = b.offsetHeight > below && above > below;
    b.style.maxHeight = (openAbove ? above : below) + 'px';
    b.style.left = Math.max(margin, Math.min(anchor.right - b.offsetWidth, innerWidth - b.offsetWidth - margin)) + 'px';
    b.style.top = (openAbove ? anchor.top - gap - b.offsetHeight : anchor.bottom + gap) + 'px';
  }
  function hide() {
    const b = body.current;
    if (b?.matches(':popover-open')) b.hidePopover();
  }
  function toggle() {
    const m = menu.current;
    if (!m?.open) { hide(); return; }
    if (actions.isBusy() || !trigger.current?.getClientRects().length) { m.open = false; return; }
    for (const other of document.querySelectorAll<HTMLDetailsElement>('.navigator-context-menu[open], .navigator-toolbar details[open]'))
      if (other !== m) other.open = false;
    position();
  }
  function context(event: MouseEvent<HTMLLIElement>) {
    if (!canEdit || !menu.current || !(event.target instanceof Element)
      || event.target.closest('.page-tree-item, .screen-row') !== event.currentTarget
      || event.target.closest('input, summary, .navigator-context-body') || actions.isBusy()) return;
    event.preventDefault(); menu.current.open = true; position();
    body.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }
  return <li className={kind === 'page' ? 'page-tree-item' : 'screen-row'} onContextMenu={context}>
    {draft?.id === id ? <RenameForm kind={kind} draft={draft} name={name} actions={actions}/> : <>
      <Button className={kind + '-select'} data-page-id={kind === 'page' ? id : undefined}
        data-screen-id={kind === 'screen' ? id : undefined} title={kind === 'screen' ? name : undefined}
        aria-pressed={selected} aria-expanded={kind === 'page' ? expanded : undefined}
        onClick={() => kind === 'page' ? actions.selectPage(id) : actions.selectScreen(id)}>{label}</Button>
      {canEdit && <>
        <input type="button" value="✎" className="navigator-rename-action"
          data-page-rename-id={kind === 'page' ? id : undefined} data-screen-rename-id={kind === 'screen' ? id : undefined}
          title={'Переименовать ' + noun} aria-label={'Переименовать ' + noun + ' «' + name + '»'}
          onClick={() => { if (!actions.isBusy()) actions.startRename(kind, id, name); }}/>
        <details className="navigator-context-menu" ref={menu} onToggle={toggle}>
          <summary ref={trigger} title={triggerLabel} aria-label={triggerLabel + ' «' + name + '»'}><Ellipsis size={16} aria-hidden="true"/></summary>
          <div ref={body} className="navigator-context-body" popover="manual">
            {menuActions.map(action => <input key={action.label} type="button" value={action.label}
              aria-label={action.accessibleLabel} className={action.destructive ? 'navigator-danger-action' : undefined}
              onClick={() => { if (menu.current) menu.current.open = false; hide(); if (!actions.isBusy()) action.run(); }}/>)}
          </div>
        </details>
      </>}
    </>}
    {children}
  </li>;
}

function ScreenList({state, actions, hidden = false}: {state: NavigatorState; actions: NavigatorActions; hidden?: boolean}) {
  return <ul id="screens" aria-label="Экраны выбранной страницы" hidden={hidden}>
    {state.screens.map((item, index) => {
      const name = item.name ?? 'Экран ' + (state.screensOffset + index + 1);
      return <NavigatorRow key={item.id} kind="screen" id={item.id} name={name}
        canEdit={state.canEdit} selected={item.id === state.selectedScreen} draft={state.editingScreenName} actions={actions}
        label={name + ' · ' + item.dimensions.width + ' × ' + item.dimensions.height}
        menuActions={[{label:'Дублировать', accessibleLabel:'Дублировать экран «' + name + '»', run:()=>actions.duplicateScreen(item)}]}/>;
    })}
  </ul>;
}

function NavigatorView({state, actions}: {state: NavigatorState; actions: NavigatorActions}) {
  const nested = state.pageExpanded && state.pages.some(item => item.id === state.selectedPage);
  return <>
    <ul id="pages" aria-label="Страницы и экраны">
      {state.pages.map(item => {
        const selected = item.id === state.selectedPage;
        return <NavigatorRow key={item.id} kind="page" id={item.id} name={item.name} label={item.name}
          canEdit={state.canEdit} selected={selected} expanded={selected && state.pageExpanded} draft={state.editingPageName}
          actions={actions} menuActions={[{label:'Удалить', accessibleLabel:'Удалить страницу', destructive:true, run:()=>actions.deletePage(item)}]}>
          {selected && nested && <ScreenList state={state} actions={actions}/>}
        </NavigatorRow>;
      })}
    </ul>
    {!nested && <ScreenList state={state} actions={actions} hidden/>}
  </>;
}

/** The navigator owns both lists, including the selected page's nested screens. */
export function createDocumentNavigatorModel() { return createViewModel(NavigatorView); }

export function createDocumentNavigator(model: ReturnType<typeof createDocumentNavigatorModel>, actions: NavigatorActions) {
  return {
    // Navigation commands restore focus immediately after rendering.
    render(state: NavigatorState) { flushSync(() => model.publish({state, actions})); },
    dispose() { model.clear(); },
  };
}
