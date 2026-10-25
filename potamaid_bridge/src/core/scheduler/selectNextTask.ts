/**
 * 次に実行する、ファイルを編集するタスクを選ぶ（仕様書3章「目標の進め方」）。
 *
 * 状態だけから決める純粋関数にして、スケジューラから切り離して確かめられるようにする。
 */
import type { Goal, Task, TaskStatus } from '../../shared/domain';

/** 実行中とみなす状態（対象modごとに1件まで） */
const RUNNING: TaskStatus[] = ['running', 'approval'];

/**
 * 1つの対象modの目標とタスクから、次に実行するタスクを返す。なければ null。
 *
 * 1. 実行中のタスクがあれば、何も始めない
 * 2. 追加の指示を待っているタスク（確認待ち・完了）を優先する
 * 3. 確認待ちのタスクがあれば、新しいタスクは始めない
 *    （ユーザーが確かめる変更に、別の変更を混ぜないため）
 * 4. 承認済みの目標を作成順に見て、依存先がすべて完了した未着手のタスクを番号順に選ぶ
 *
 * @param goals 対象modの目標（作成順）
 * @param tasks それらの目標のタスク
 */
export function selectNextTask(goals: Goal[], tasks: Task[]): Task | null {
  if (tasks.some((t) => RUNNING.includes(t.status))) {
    return null;
  }

  const goalOrder = new Map(goals.map((g, i) => [g.id, i]));
  const ordered = [...tasks].sort(
    (a, b) =>
      (goalOrder.get(a.goalId) ?? 0) - (goalOrder.get(b.goalId) ?? 0) ||
      a.number - b.number,
  );

  const inReview = ordered.filter((t) => t.status === 'review');
  // 確認待ちがあるときは、その確認待ちのタスクへの追加の指示だけを受け付ける
  const followUpCandidates =
    inReview.length > 0 ? inReview : ordered.filter((t) => t.status === 'done');
  const followUp = followUpCandidates.find((t) => t.pendingInstructions > 0);
  if (followUp) {
    return followUp;
  }
  if (inReview.length > 0) {
    return null;
  }

  const done = new Set(
    tasks.filter((t) => t.status === 'done').map((t) => t.id),
  );
  const activeGoals = new Set(
    goals.filter((g) => g.status === 'active').map((g) => g.id),
  );
  return (
    ordered.find(
      (t) =>
        activeGoals.has(t.goalId) &&
        t.status === 'todo' &&
        t.dependsOn.every((dep) => done.has(dep)),
    ) ?? null
  );
}
