import type { ReactNode } from 'react';

/** サイドバーなどの見出しと、右端の操作 */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center px-2 pb-1.5">
      <h2 className="text-xs font-bold text-muted">{title}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
