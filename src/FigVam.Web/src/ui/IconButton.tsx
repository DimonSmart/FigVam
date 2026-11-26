import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';

type Props = Omit<ComponentProps<typeof Button>, 'children' | 'aria-label'> & {
  icon: LucideIcon; label: string; iconSize?: number;
};
export function IconButton({icon: Icon, label, title = label, iconSize = 16, ...props}: Props) {
  return <Button {...props} title={title} aria-label={label}><Icon size={iconSize} aria-hidden="true"/></Button>;
}
