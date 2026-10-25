/**
 * スナップショットから画面に出す値を求める関数（状態を持たない）。
 */
import type {
  Approval,
  Consult,
  Goal,
  ProgressOwner,
  Task,
} from '../../shared/domain';
import { isGoalWorkFinished, isTaskWorkFinished } from '../../shared/goals';
import type { BridgeSnapshot } from '../../shared/ipc';
import type { GoalDisplayStatus } from './statusMeta';

export function projectGoals(
  snapshot: BridgeSnapshot,
  projectId: string,
): Goal[] {
  return snapshot.goals.filter((g) => g.projectId === projectId);
}

export function projectConsults(
  snapshot: BridgeSnapshot,
  projectId: string,
): Consult[] {
  return snapshot.consults.filter((c) => c.projectId === projectId);
}

export function projectApprovals(
  snapshot: BridgeSnapshot,
  projectId: string,
): Approval[] {
  return snapshot.approvals.filter((a) => a.projectId === projectId);
}

/** 目標のタスクを番号順に返す */
export function goalTasks(snapshot: BridgeSnapshot, goalId: string): Task[] {
  return snapshot.tasks
    .filter((t) => t.goalId === goalId)
    .sort((a, b) => a.number - b.number);
}

export function goalDisplayStatus(
  goal: Goal,
  tasks: Task[],
): GoalDisplayStatus {
  if (goal.status === 'review' && !isGoalWorkFinished(tasks)) {
    return 'fixing';
  }
  return goal.status;
}

/** 計画を承認したあとの目標か（ボードとタスクの詳細を出す） */
export function isGoalStarted(goal: Goal): boolean {
  return (
    goal.status === 'active' ||
    goal.status === 'review' ||
    goal.status === 'done'
  );
}

export interface GoalProgress {
  done: number;
  total: number;
  /** 0〜100 */
  percent: number;
}

export function goalProgress(tasks: Task[]): GoalProgress {
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/** 依存先のタスクの番号の一覧（"#1・#2"） */
export function dependencyNumbers(task: Task, tasks: Task[]): string {
  const numberOf = new Map(tasks.map((t) => [t.id, t.number]));
  return task.dependsOn
    .map((id) => numberOf.get(id))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)
    .map((n) => `#${n}`)
    .join('・');
}

/** 「#1・#2 の後に実行」のような依存関係の説明 */
export function dependencyText(task: Task, tasks: Task[]): string {
  const deps = dependencyNumbers(task, tasks);
  return deps ? `${deps} の後に実行` : '最初に実行できます';
}

/**
 * ボードのカードに出す、状態の補足。
 * 未着手のタスクは、依存先の完了待ちか、次に実行するかを示す。
 */
export function describeTask(task: Task, tasks: Task[]): string {
  if (task.paused) {
    return task.status === 'running' || task.status === 'approval'
      ? '中止しています…'
      : '停止中（再開待ち）';
  }
  switch (task.status) {
    case 'todo': {
      const done = new Set(tasks.filter(isTaskWorkFinished).map((t) => t.id));
      const waiting = tasks.filter(
        (t) => task.dependsOn.includes(t.id) && !done.has(t.id),
      );
      if (waiting.length > 0) {
        return `${waiting.map((t) => `#${t.number}`).join('・')} の完了後`;
      }
      // 調査タスクは並行して実行するため、編集タスクの中での順番だけを示す
      if (task.kind === 'investigate') {
        return '実行できます（空きを待っています）';
      }
      const firstRunnable = tasks.find(
        (t) =>
          t.kind === 'edit' &&
          !t.paused &&
          t.status === 'todo' &&
          t.dependsOn.every((dep) => done.has(dep)),
      );
      return firstRunnable?.id === task.id
        ? '次に実行'
        : '実行できます（順番待ち）';
    }
    case 'running':
      return task.latest ?? '作業中…';
    case 'approval':
      return task.latest ?? '承認待ち';
    case 'failed':
      return task.error ?? '失敗しました';
    case 'done':
      return task.pendingInstructions > 0
        ? `追加の指示 ${task.pendingInstructions} 件を順番待ち`
        : '';
  }
}

/** タスク・相談・計画づくりの承認待ち */
export function ownerApprovals(
  approvals: Approval[],
  owner: ProgressOwner,
): Approval[] {
  return approvals.filter(
    (a) => a.owner.type === owner.type && a.owner.id === owner.id,
  );
}
