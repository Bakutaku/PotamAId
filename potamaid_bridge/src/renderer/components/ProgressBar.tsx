/** 進み具合の細い棒（daisyUI の progress） */
export function ProgressBar({
  percent,
  label,
}: {
  /** 0〜100 */
  percent: number;
  /** 読み上げ用の説明 */
  label: string;
}) {
  return (
    <progress
      className="progress progress-success h-1 flex-1"
      value={percent}
      max={100}
      aria-label={label}
    />
  );
}
