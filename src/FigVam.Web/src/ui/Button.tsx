import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentProps } from 'react';

/** Default to a non-submitting button; submit must be intentional. */
export function Button({ type = 'button', ...props }: ComponentProps<typeof BaseButton>) {
  return <BaseButton type={type} {...props} />;
}
