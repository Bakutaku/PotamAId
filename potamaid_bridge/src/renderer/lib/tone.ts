/**
 * 状態の色の種類と、Tailwind のクラスの対応。
 *
 * Tailwind はソースの中の文字列からクラスを見つけるため、
 * クラス名は組み立てずに、ここに完全な形で書いておく。
 * 文字の色は、明るい背景でも読めるように濃くした *-strong を使う（index.css）。
 */
export type Tone =
  | 'neutral'
  | 'info'
  | 'warning'
  | 'accent'
  | 'success'
  | 'error';

/** バッジ（daisyUI の badge に重ねる、薄い背景と濃い文字） */
export const BADGE_CLASS: Record<Tone, string> = {
  neutral: 'bg-base-200 text-muted',
  info: 'bg-info/15 text-info-strong',
  warning: 'bg-warning/15 text-warning-strong',
  accent: 'bg-accent/15 text-accent-strong',
  success: 'bg-success/15 text-success-strong',
  error: 'bg-error/15 text-error-strong',
};

/** 小さな丸の印 */
export const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-muted',
  info: 'bg-info',
  warning: 'bg-warning',
  accent: 'bg-accent',
  success: 'bg-success',
  error: 'bg-error',
};

/** 文字の色 */
export const TEXT_CLASS: Record<Tone, string> = {
  neutral: 'text-muted',
  info: 'text-info-strong',
  warning: 'text-warning-strong',
  accent: 'text-accent-strong',
  success: 'text-success-strong',
  error: 'text-error-strong',
};
