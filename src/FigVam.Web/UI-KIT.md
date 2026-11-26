# FigVam UI Kit

Implementation catalog for FigVam's application chrome. It is not a catalog of components that can be inserted into a design document.

| Component | Purpose | Source | Usage |
| --- | --- | --- | --- |
| Button | Standard action, including disabled state and accessible native button behavior. Defaults to non-submit. | `src/ui/Button.tsx` | `<Button onClick={refresh}>Обновить</Button>`; use `type="submit"` for form submission. |

| Pagination | Revision-pinned catalog navigation; consistent disabled states and accessible labels. | `src/ui/Pagination.tsx` | `<Pagination prefix="components" ... />` |

Use the existing component before adding an alternative. Lucide React provides standard application icons; retain specialized canvas and document icons where appropriate.
