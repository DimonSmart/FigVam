# FigVam UI Kit

Application chrome only; not the component catalog or design tokens of user documents.

| Component | Source | Usage and constraints |
| --- | --- | --- |
| Button | `src/ui/Button.tsx` | `<Button onClick={refresh}>Обновить</Button>`. Base UI, defaults to non-submitting; use `type="submit"` deliberately. |
| IconButton | `src/ui/IconButton.tsx` | `<IconButton icon={Trash2} label="Удалить" onClick={remove}/>`. Lucide icon, required accessible name, native title; do not use an unlabeled icon. |
| TextInput | `src/ui/Inputs.tsx` | `<TextInput id="name" value={draft} onChange={change}/>`. Base UI Input, native ref and validation; associate a label. |
| NumberInput | `src/ui/Inputs.tsx` | `<NumberInput min={0} step="any" value={draft} onChange={change}/>`. Native number field for browser numeric semantics; caller owns validation and commit policy. |
| InlineError | `src/ui/Feedback.tsx` | `<InlineError id="save-error">{error}</InlineError>`. Alert for an error, not routine progress. |
| StatusMessage | `src/ui/Feedback.tsx` | `<StatusMessage id="save-status">{status}</StatusMessage>`. Polite live status. |
| Pagination | `src/ui/Pagination.tsx` | `<Pagination prefix="components" ... />`. Revision-pinned navigation with consistent disabled states. |

Use the existing component before adding an alternative. Native select, checkbox, file and numeric fields remain appropriate where their browser behavior is sufficient; specialized canvas controls are separate. Standard application icons use Lucide React. Shared components inherit the application's semantic CSS tokens and must not reference user document tokens.
