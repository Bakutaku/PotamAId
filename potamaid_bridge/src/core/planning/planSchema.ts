/**
 * 目標の計画の形式（構造化出力）。
 *
 * 計画の作成では、AI の最後の発言を {@link PLAN_OUTPUT_SCHEMA} の JSON にさせ、
 * {@link parsePlan} で検証してからタスクとして保存する。
 */
import type { TaskKind } from '../../shared/domain';
import { checkTaskGraph, sortByDependencies } from './taskGraph';

/** AI が返す計画 */
export interface PlanOutput {
  /** 目標の短い題名 */
  goalTitle: string;
  /** 計画の要約（ユーザーへの説明） */
  summary: string;
  tasks: PlanTaskOutput[];
}

export interface PlanTaskOutput {
  /** 計画の中だけで使う識別子（"t1" など）。依存関係の参照に使う */
  key: string;
  title: string;
  description: string;
  kind: TaskKind;
  dependsOn: string[];
}

const TASK_KINDS: readonly TaskKind[] = ['edit', 'investigate'];

/**
 * turn/start の outputSchema に渡す JSON Schema。
 * 構造化出力の制約に合わせ、すべての項目を必須にして余分な項目を禁止する。
 */
export const PLAN_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['goalTitle', 'summary', 'tasks'],
  properties: {
    goalTitle: {
      type: 'string',
      description: '目標の短い題名（20文字程度）',
    },
    summary: {
      type: 'string',
      description: '調べた結果と計画の方針の要約',
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'description', 'kind', 'dependsOn'],
        properties: {
          key: { type: 'string', description: 't1, t2 のような識別子' },
          title: { type: 'string', description: 'タスクの短い題名' },
          description: {
            type: 'string',
            description:
              '実装する内容と変更するファイルの見込み（調査タスクは、調べる内容と後のタスクに渡す結果）',
          },
          kind: {
            type: 'string',
            enum: TASK_KINDS,
            description:
              'edit: ファイルを編集するタスク。investigate: 読み取り専用で調べるだけのタスク',
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: '先に完了している必要があるタスクの key',
          },
        },
      },
    },
  },
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * AI の最後の発言を計画として読む。
 * 形式・識別子の重複・依存関係を検証し、依存先が先に来るように並べ替えて返す。
 */
export function parsePlan(text: string | null): ParseResult<PlanOutput> {
  if (!text) {
    return { ok: false, error: 'AI が計画を返しませんでした' };
  }
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: '計画を JSON として読めませんでした' };
  }
  if (!isPlanOutput(value)) {
    return { ok: false, error: '計画の形式が正しくありません' };
  }
  if (value.tasks.length === 0) {
    return { ok: false, error: '計画にタスクがありません' };
  }
  const keys = value.tasks.map((t) => t.key);
  const duplicated = keys.find((key, i) => keys.indexOf(key) !== i);
  if (duplicated) {
    return {
      ok: false,
      error: `タスクの識別子 ${duplicated} が重複しています`,
    };
  }
  const nodes = value.tasks.map((t) => ({ ...t, id: t.key }));
  const check = checkTaskGraph(nodes);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  return {
    ok: true,
    value: {
      goalTitle: value.goalTitle.trim(),
      summary: value.summary.trim(),
      tasks: sortByDependencies(nodes).map(({ id: _id, ...task }) => task),
    },
  };
}

/** 発言が ```json のコードブロックで囲まれていた場合に中身を取り出す */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function isPlanOutput(value: unknown): value is PlanOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.goalTitle === 'string' &&
    typeof plan.summary === 'string' &&
    Array.isArray(plan.tasks) &&
    plan.tasks.every(isPlanTask)
  );
}

function isPlanTask(value: unknown): value is PlanTaskOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const task = value as Record<string, unknown>;
  return (
    typeof task.key === 'string' &&
    typeof task.title === 'string' &&
    typeof task.description === 'string' &&
    TASK_KINDS.includes(task.kind as TaskKind) &&
    Array.isArray(task.dependsOn) &&
    task.dependsOn.every((d) => typeof d === 'string')
  );
}
