import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  icon: IconName;
  /** 読み上げとツールチップに使う説明（アイコンだけのボタンには必須） */
  label: string;
  size?: 'xs' | 'sm' | 'md';
}

const SIZE_CLASS = { xs: 'btn-xs', sm: 'btn-sm', md: '' } as const;
const ICON_SIZE = { xs: 13, sm: 15, md: 16 } as const;

/** アイコンだけのボタン（daisyUI の btn-ghost btn-square） */
export function IconButton({
  icon,
  label,
  size = 'sm',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`btn btn-ghost btn-square ${SIZE_CLASS[size]} ${className}`}
      {...props}
    >
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  );
}
