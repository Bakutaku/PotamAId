import type { ReactNode } from 'react';
import logo from '../../../assets/river-spirit.png';

/** 表示するものがないときの案内（ロゴの川の精霊を添える） */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center">
      <img
        src={logo}
        alt=""
        className="size-12 animate-bob [image-rendering:pixelated]"
      />
      <p className="text-sm font-bold">{title}</p>
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action}
    </div>
  );
}
