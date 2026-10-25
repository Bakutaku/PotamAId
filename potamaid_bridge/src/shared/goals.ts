/**
 * 目標の進み具合の判定（Bridge の本体と画面の両方で使う）。
 */
import type { Goal, Task } from './domain';

/**
 * タスクの作業が終わったか（完了し、AI に渡していない指示もない）。
 * 追加の指示を待つ完了のタスクは、結果が変わるので終わっていないとみなす。
 */
export function isTaskWorkFinished(task: Task): boolean {
  return task.status === 'done' && task.pendingInstructions === 0;
}

/** 目標のタスクの作業がすべて終わったか */
export function isGoalWorkFinished(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every(isTaskWorkFinished);
}

/** いまの作業の区切りで、反映にゲームの再起動が必要になったタスク */
export function restartRequiredTasks(goal: Goal, tasks: Task[]): Task[] {
  const since = goal.roundStartedAt ?? 0;
  return tasks.filter(
    (t) =>
      t.kind === 'edit' && t.needsGameRestart && (t.finishedAt ?? 0) >= since,
  );
}
