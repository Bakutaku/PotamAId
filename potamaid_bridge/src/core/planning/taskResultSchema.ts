/**
 * タスクの結果の報告の形式（構造化出力）。
 *
 * 再起動が必要かどうか（仕様書9章「再起動が必要」の判定）は、AI に報告させる。
 */
import { extractJson } from './planSchema';

export interface TaskResultOutput {
  /** 行った変更と、ユーザーが確かめる方法の要約 */
  summary: string;
  /** ブロック・アイテムの新しい登録など、反映にゲームの再起動が必要か */
  needsGameRestart: boolean;
}

export const TASK_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'needsGameRestart'],
  properties: {
    summary: {
      type: 'string',
      description: '行った変更と、ゲーム内や VS Code で確かめる方法の要約',
    },
    needsGameRestart: {
      type: 'boolean',
      description:
        '新しい登録やイベントリスナーの追加など、反映にゲームの再起動が必要なら true',
    },
  },
};

/** 調査タスクの結果。調べた結果は、依存するタスクの指示に添える */
export const INVESTIGATE_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: {
      type: 'string',
      description:
        '調べて分かったこと（関係するファイル・クラス・手順など）。後のタスクがそのまま使えるように具体的に書く',
    },
  },
};

/** AI の最後の発言を結果として読む。JSON でなければ、発言をそのまま要約として扱う */
export function parseTaskResult(text: string | null): TaskResultOutput {
  if (!text) {
    return { summary: '', needsGameRestart: false };
  }
  try {
    const value = JSON.parse(extractJson(text)) as Partial<TaskResultOutput>;
    if (typeof value.summary === 'string') {
      return {
        summary: value.summary,
        needsGameRestart: value.needsGameRestart === true,
      };
    }
  } catch {
    // JSON でなければ下で発言をそのまま使う
  }
  return { summary: text, needsGameRestart: false };
}
