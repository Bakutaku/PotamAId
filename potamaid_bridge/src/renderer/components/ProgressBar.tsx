/**
 * 進み具合の細い棒。
 * progress 要素は値が変わったときに動かせないため、div で作って幅をなめらかに伸ばす
 */
export function ProgressBar({
  percent,
  label,
  className = 'flex-1',
}: {
  /** 0〜100 */
  percent: number;
  /** 読み上げ用の説明 */
  label: string;
  /** 幅などの指定（既定は残りの幅いっぱい） */
  className?: string;
}) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={`block h-1 overflow-hidden rounded-full bg-base-content/10 ${className}`}
    >
      <span
        className="block h-full rounded-full bg-success transition-[width] duration-700 ease-out"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
