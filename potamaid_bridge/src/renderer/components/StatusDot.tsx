import { DOT_CLASS, type Tone } from '../lib/tone';

/** 状態を示す小さな丸。label を渡すと読み上げられる */
export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
