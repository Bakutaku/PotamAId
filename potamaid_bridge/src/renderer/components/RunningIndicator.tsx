/** 「応答中…」の表示 */
export function RunningIndicator({ label = '応答中…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-info-strong">
      <span className="loading loading-dots loading-xs" aria-hidden="true" />
      {label}
    </div>
  );
}
