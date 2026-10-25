import { DOT_CLASS, type Tone } from '../lib/tone';

/**
 * 状態を示す小さな丸。label を渡すと読み上げられる。
 * pulse を付けると周りに輪が広がり、実行中であることを示す
 */
export function StatusDot({
  tone,
  label,
  pulse = false,
}: {
  tone: Tone;
  label?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={`relative inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {pulse && (
        <span
          className={`absolute inset-0 animate-ping-soft rounded-full motion-reduce:hidden ${DOT_CLASS[tone]}`}
        />
      )}
    </span>
  );
}
