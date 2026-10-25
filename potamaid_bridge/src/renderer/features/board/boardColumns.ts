import type { TaskStatus } from '../../../shared/domain';
import type { Tone } from '../../lib/tone';

/** ボードの列（仕様書5章「アプリの画面」: 未着手 → 応答中 → 確認待ち → 完了） */
export interface BoardColumnDef {
  id: string;
  title: string;
  /** この列に並べる状態 */
  statuses: TaskStatus[];
  tone: Tone;
  /** 完了の列は目立ちすぎないよう、カードを小さくする */
  compact: boolean;
  /** 列の幅の比率と最小の幅（横幅が足りないときは横にスクロールする） */
  grow: number;
  minWidthClass: string;
}

export const BOARD_COLUMNS: BoardColumnDef[] = [
  {
    id: 'todo',
    title: '未着手',
    statuses: ['todo'],
    tone: 'neutral',
    compact: false,
    grow: 1,
    minWidthClass: 'min-w-[190px]',
  },
  {
    id: 'running',
    title: '応答中',
    statuses: ['running', 'approval'],
    tone: 'info',
    compact: false,
    grow: 1.2,
    minWidthClass: 'min-w-[210px]',
  },
  {
    id: 'review',
    title: '確認待ち',
    statuses: ['review', 'failed'],
    tone: 'accent',
    compact: false,
    grow: 1.2,
    minWidthClass: 'min-w-[210px]',
  },
  {
    id: 'done',
    title: '完了',
    statuses: ['done'],
    tone: 'success',
    compact: true,
    grow: 0.9,
    minWidthClass: 'min-w-[170px]',
  },
];
