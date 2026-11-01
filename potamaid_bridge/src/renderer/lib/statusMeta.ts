/**
 * 状態の表示名と色（モックの対応表に合わせる）。
 */
import type {
  ConsultStatus,
  GoalStatus,
  ProgressKind,
  ProviderState,
  TaskStatus,
  TaskWeight,
} from '../../shared/domain';
import { WEIGHT_META } from './runOptions';
import type { Tone } from './tone';

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  todo: { label: '未着手', tone: 'neutral' },
  running: { label: '応答中', tone: 'info' },
  approval: { label: '承認待ち', tone: 'warning' },
  done: { label: '完了', tone: 'success' },
  failed: { label: '失敗', tone: 'error' },
};

/** 調査タスクに付ける印 */
export const INVESTIGATE_META: StatusMeta = { label: '調査', tone: 'info' };

/** タスクの重さの印。重いほど目立つ色にする */
const WEIGHT_TONE: Record<TaskWeight, Tone> = {
  light: 'neutral',
  standard: 'neutral',
  heavy: 'warning',
  max: 'error',
};

export function weightMeta(weight: TaskWeight): StatusMeta {
  return { label: WEIGHT_META[weight].label, tone: WEIGHT_TONE[weight] };
}

/**
 * 目標の表示上の状態。
 * 確認中の目標は、修正を実行している間を「修正中」、それ以外を「確認待ち」と表示する
 */
export type GoalDisplayStatus = GoalStatus | 'fixing';

export const GOAL_STATUS: Record<GoalDisplayStatus, StatusMeta> = {
  planning: { label: '計画中', tone: 'info' },
  planReview: { label: '計画の確認待ち', tone: 'warning' },
  planFailed: { label: '計画の失敗', tone: 'error' },
  active: { label: '進行中', tone: 'info' },
  waiting: { label: '反映待ち', tone: 'warning' },
  review: { label: '確認待ち', tone: 'accent' },
  fixing: { label: '修正中', tone: 'info' },
  done: { label: '完了', tone: 'success' },
};

export const CONSULT_STATUS: Record<ConsultStatus, StatusMeta> = {
  idle: { label: '', tone: 'neutral' },
  queued: { label: '順番待ち', tone: 'neutral' },
  running: { label: '応答中', tone: 'info' },
  failed: { label: '失敗', tone: 'error' },
};

export const PROVIDER_STATE_TONE: Record<ProviderState, Tone> = {
  checking: 'neutral',
  ready: 'success',
  notLoggedIn: 'warning',
  unavailable: 'error',
  notSupported: 'neutral',
};

/** 途中経過の一覧の左に出す短い名前 */
export const PROGRESS_TAG: Record<ProgressKind, string> = {
  user: '指示',
  agent: '発言',
  reasoning: '思考',
  command: '実行',
  fileChange: '編集',
  mcp: 'MCP',
  webSearch: '検索',
  system: 'Bridge',
  error: 'エラー',
};
