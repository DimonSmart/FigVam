import type { ComponentProps } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';

/** Preserve the native input contract (including ref, validation and focus). */
export function TextInput({ type = 'text', ...props }: ComponentProps<typeof BaseInput>) {
  return <BaseInput type={type} {...props}/>;
}
/** Native number semantics are required by the editor's numeric draft validation. */
export function NumberInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="number" {...props}/>;
}
