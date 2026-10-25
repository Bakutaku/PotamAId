/**
 * 次に実行するタスクを選ぶ（仕様書3章「目標の進め方」）。
 *
 * 状態だけから決める純粋関数にして、スケジューラから切り離して確かめられるようにする。
 */
import type { Goal, Task, TaskStatus } from '../../shared/domain';
import { isTaskWorkFinished } from '../../shared/goals';

/** 実行中とみなす状態 */
const RUNNING: TaskStatus[] = ['running', 'approval'];

/** タスクを実行できる目標の状態（計画を承認済みで、完了にしていない） */
const RUNNABLE_GOALS: Goal['status'][] = ['active', 'review'];

/**
 * 1つの対象modの目標とタスクから、次に実行する編集タスクを返す。なければ null。
 *
 * 1. 実行中の編集タスクがあれば、何も始めない（対象modごとに1件まで）
 * 2. 確認中の目標があれば、その目標のタスクだけを対象にする
 *    （ユーザーが確かめる変更に、別の目標の変更を混ぜないため）
 * 3. 追加の指示を待っている完了のタスクを優先する
 * 4. 目標を作成順に見て、依存先の作業がすべて終わった未着手のタスクを番号順に選ぶ
 *
 * @param goals 対象modの目標（作成順）
 * @param tasks それらの目標のタスク
 */
export function selectNextEditTask(goals: Goal[], tasks: Task[]): Task | null {
  const edits = tasks.filter((t) => t.kind === 'edit');
  if (edits.some((t) => RUNNING.includes(t.status))) {
    return null;
  }
  const reviewing = goals.filter((g) => g.status === 'review');
  const targets = reviewing.length > 0 ? reviewing : goals;
  return selectRunnable(targets, tasks, edits, () => true);
}

/**
 * 1つの対象modの目標とタスクから、次に実行する調査タスクを返す。なければ null。
 * 調査タスクは読み取り専用なので、確認中の目標があっても実行する。
 *
 * @param running 実行中か、実行を始めたタスクの ID（同じタスクを二重に始めないため）
 */
export function selectNextInvestigateTask(
  goals: Goal[],
  tasks: Task[],
  running: ReadonlySet<string>,
): Task | null {
  const investigations = tasks.filter((t) => t.kind === 'investigate');
  return selectRunnable(
    goals,
    tasks,
    investigations,
    (t) => !running.has(t.id) && !RUNNING.includes(t.status),
  );
}

/**
 * 候補から、実行できるタスクを選ぶ。
 * 追加の指示を待っている完了のタスクを先に、次に依存先の作業がすべて終わった未着手のタスクを選ぶ。
 */
function selectRunnable(
  goals: Goal[],
  tasks: Task[],
  candidates: Task[],
  available: (task: Task) => boolean,
): Task | null {
  const goalOrder = new Map(
    goals
      .filter((g) => RUNNABLE_GOALS.includes(g.status))
      .map((g, i) => [g.id, i]),
  );
  const ordered = candidates
    .filter((t) => !t.paused && goalOrder.has(t.goalId) && available(t))
    .sort(
      (a, b) =>
        (goalOrder.get(a.goalId) ?? 0) - (goalOrder.get(b.goalId) ?? 0) ||
        a.number - b.number,
    );

  const followUp = ordered.find(
    (t) => t.status === 'done' && t.pendingInstructions > 0,
  );
  if (followUp) {
    return followUp;
  }
  // 追加の指示を待つ依存先は、結果が変わるので、その指示を終えるまで待つ
  const done = new Set(tasks.filter(isTaskWorkFinished).map((t) => t.id));
  return (
    ordered.find(
      (t) => t.status === 'todo' && t.dependsOn.every((dep) => done.has(dep)),
    ) ?? null
  );
}
