import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<'p'>, 'role' | 'aria-live'>;
export function StatusMessage(props: Props) {
  return <p {...props} role="status" aria-live="polite"/>;
}
export function InlineError(props: Props) {
  return <p {...props} role="alert"/>;
}
