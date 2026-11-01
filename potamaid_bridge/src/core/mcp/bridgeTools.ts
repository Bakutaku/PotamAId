/**
 * Bridge の MCP ツールの中身（仕様書5章「Bridge の MCP ツール」）。
 *
 * AI が目標やほかのタスクの詳細を必要なときに調べられるようにする。
 * すべて読み取り専用で、セッションの対象mod（と目標）の範囲だけを返す。
 * HTTP や MCP の処理には依存させず、文字列を返す関数として書く（テストしやすくするため）。
 */
import type { Goal, GoalStatus, Task, TaskStatus } from '../../shared/domain';
import type { BridgeStore } from '../store/BridgeStore';

/** AI から見える MCP サーバーの名前（ツール名の前に付く） */
export const BRIDGE_MCP_SERVER_NAME = 'potamaid_bridge';

/** ツールを使えるセッションの範囲 */
export interface ToolScope {
  projectId: string;
  /** 計画・タスクのセッションの目標。goalId を省いたときに使う。相談では null */
  goalId: string | null;
}

/** ツールの呼び出しの失敗（AI にエラーとして返す） */
export class ToolError extends Error {}

const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  planning: '計画中',
  planReview: '計画の確認待ち',
  planFailed: '計画の失敗',
  active: '進行中',
  waiting: '反映待ち',
  review: '確認待ち',
  done: '完了',
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '未着手',
  running: '実行中',
  approval: '承認待ち',
  done: '完了',
  failed: '失敗',
};

export class BridgeTools {
  constructor(private readonly store: BridgeStore) {}

  /** 対象modの目標の一覧 */
  listGoals(scope: ToolScope): string {
    const goals = this.store.goals
      .list()
      .filter((g) => g.projectId === scope.projectId);
    if (goals.length === 0) {
      return '目標はありません。';
    }
    return goals
      .map((goal) => {
        const tasks = this.store.tasks.listByGoal(goal.id);
        const done = tasks.filter((t) => t.status === 'done').length;
        const current =
          goal.id === scope.goalId ? '・このセッションの目標' : '';
        return `- ${goal.title}（${GOAL_STATUS_LABEL[goal.status]}・タスク ${done}/${tasks.length}${current}）goalId: ${goal.id}`;
      })
      .join('\n');
  }

  /** 目標の依頼文・計画の方針・タスクの一覧 */
  getGoal(scope: ToolScope, goalId: string | undefined): string {
    const goal = this.resolveGoal(scope, goalId);
    const tasks = this.store.tasks.listByGoal(goal.id);
    const lines = [
      `# ${goal.title}（${GOAL_STATUS_LABEL[goal.status]}）`,
      `goalId: ${goal.id}`,
      '',
      '## 依頼文',
      goal.text,
    ];
    if (goal.planSummary) {
      lines.push('', '## 計画の方針', goal.planSummary);
    }
    lines.push(
      '',
      '## タスク',
      tasks.length > 0
        ? tasks.map((t) => taskLine(t, tasks)).join('\n')
        : 'まだありません。',
    );
    return lines.join('\n');
  }

  /** タスクの内容・状態・結果 */
  getTask(
    scope: ToolScope,
    number: number,
    goalId: string | undefined,
  ): string {
    const goal = this.resolveGoal(scope, goalId);
    const tasks = this.store.tasks.listByGoal(goal.id);
    const task = tasks.find((t) => t.number === number);
    if (!task) {
      throw new ToolError(
        `目標「${goal.title}」にタスク #${number} はありません（#1〜#${tasks.length}）。`,
      );
    }
    const lines = [
      `# ${taskLine(task, tasks).slice(2)}`,
      `目標: ${goal.title}`,
      '',
      '## 内容',
      task.description || '（なし）',
    ];
    if (task.result) {
      lines.push('', '## 結果', task.result);
    }
    if (task.status === 'running' && task.latest) {
      lines.push('', '## いま行っていること', task.latest);
    }
    if (task.error) {
      lines.push('', '## 失敗の理由', task.error);
    }
    if (task.needsGameRestart) {
      lines.push('', '反映にはゲームの再起動が必要です。');
    }
    return lines.join('\n');
  }

  /** goalId を省いたらセッションの目標。ほかの対象modの目標は返さない */
  private resolveGoal(scope: ToolScope, goalId: string | undefined): Goal {
    const id = goalId || scope.goalId;
    if (!id) {
      throw new ToolError(
        'goalId を指定してください。list_goals で目標の一覧を調べられます。',
      );
    }
    const goal = this.store.goals.find(id);
    if (!goal || goal.projectId !== scope.projectId) {
      throw new ToolError(
        `目標 ${id} は見つかりません。list_goals で目標の一覧を調べられます。`,
      );
    }
    return goal;
  }
}

/** タスクの一覧の1行（「- #2 題名（調査・#1 の後・完了）」） */
function taskLine(task: Task, tasks: Task[]): string {
  const numberOf = new Map(tasks.map((t) => [t.id, t.number]));
  const deps = task.dependsOn
    .map((id) => numberOf.get(id))
    .filter((n) => n !== undefined)
    .map((n) => `#${n}`)
    .join('・');
  const notes = [
    task.kind === 'investigate' ? '調査' : '編集',
    deps && `${deps} の後`,
    TASK_STATUS_LABEL[task.status],
  ].filter(Boolean);
  return `- #${task.number} ${task.title}（${notes.join('・')}）`;
}
