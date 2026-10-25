import type { ReactNode } from 'react';

/** 表示するものがないときの案内 */
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
    <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center">
      <p className="text-sm font-bold">{title}</p>
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action}
    </div>
  );
}
