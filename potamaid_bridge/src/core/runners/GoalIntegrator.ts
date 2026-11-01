/**
 * 目標の変更の反映（仕様書3章「worktree での並行実行」）。
 *
 * 目標のタスクがすべて完了したら、次の順に進める。
 * 1. 対象modに確認中の目標があれば「反映待ち」にし、確認が終わった順に反映する
 * 2. 分岐元のブランチの新しい変更を目標のブランチに取り込む。
 *    競合したら、競合を解く編集タスクを目標に追加して worktree の中で実行させる（目標は進行中のまま）
 * 3. ゲームを起動するディレクトリにコミットしていない変更があるなどで置けなければ、
 *    反映を止めて「反映待ち」にし、知らせる。利用者が「反映する」を押すと、もう一度試す
 * 4. 目標の変更をコミットしない変更として置き、目標を確認中にして知らせる
 *
 * git の操作は時間がかかるので、対象modごとに1件ずつ順に行う。
 */
import { randomUUID } from 'node:crypto';
import type { Goal, Task } from '../../shared/domain';
import { isGoalWorkFinished, restartRequiredTasks } from '../../shared/goals';
import type { GoalWorkspaces } from '../git/GoalWorkspaces';
import type { RunnerContext } from './RunnerContext';

/** 分岐元が何度も進んで反映できないときに、取り込みをやり直す回数 */
const MAX_MERGE_ATTEMPTS = 3;

export class GoalIntegrator {
  /** 対象mod の ID → 実行中の反映の処理 */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly ctx: RunnerContext,
    private readonly workspaces: GoalWorkspaces,
    /** タスクを追加した（スケジューラに実行を頼む） */
    private readonly onTasksAdded: () => void,
    /** 想定外のエラーの記録先 */
    private readonly onError: (error: unknown) => void,
  ) {}

  /** 目標の反映を試みる。終わるまで待てる */
  request(goalId: string): Promise<void> {
    const goal = this.ctx.store.goals.find(goalId);
    if (!goal) {
      return Promise.resolve();
    }
    return this.enqueue(goal.projectId, () => this.integrate(goalId));
  }

  /** 対象modの反映待ちの目標のうち、最も古いものの反映を試みる（確認が終わったときなど） */
  requestWaiting(projectId: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      const waiting = this.ctx.store.goals
        .list()
        .find((g) => g.projectId === projectId && g.status === 'waiting');
      if (waiting) {
        await this.integrate(waiting.id);
      }
    });
  }

  /** 実行中の反映の処理が終わるのを待つ（テスト・終了用） */
  async idle(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }

  private enqueue(projectId: string, job: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    // 個別の目標の失敗は integrate の中で反映待ちにしているので、ここで受けるのは想定外のものだけ
    const next = previous.then(job).catch(this.onError);
    this.queues.set(projectId, next);
    void next.finally(() => {
      if (this.queues.get(projectId) === next) {
        this.queues.delete(projectId);
      }
    });
    return next;
  }

  private async integrate(goalId: string): Promise<void> {
    const { store } = this.ctx;
    if (this.ctx.closing) {
      return;
    }
    const goal = store.goals.find(goalId);
    const project = goal && store.projects.find(goal.projectId);
    if (
      !goal ||
      !project ||
      (goal.status !== 'active' && goal.status !== 'waiting') ||
      !goal.worktreePath ||
      !isGoalWorkFinished(store.tasks.listByGoal(goalId))
    ) {
      return;
    }
    const reviewing = store.goals
      .list()
      .some((g) => g.projectId === goal.projectId && g.status === 'review');
    if (reviewing) {
      this.wait(goal, 'ほかの目標の確認が終わるのを待っています', false);
      return;
    }

    try {
      for (let attempt = 0; ; attempt++) {
        const conflicts = await this.workspaces.mergeBase(goal);
        if (conflicts.length > 0) {
          this.addConflictTask(goal, conflicts);
          return;
        }
        const check = await this.workspaces.checkRoot(project.rootPath, goal);
        if (check.ok) {
          break;
        }
        if ('reason' in check) {
          this.wait(goal, check.reason, true);
          return;
        }
        if (attempt + 1 >= MAX_MERGE_ATTEMPTS) {
          this.wait(
            goal,
            '分岐元のブランチが更新され続けているため、反映できませんでした。「反映する」を押してやり直してください',
            true,
          );
          return;
        }
      }
      if (this.ctx.closing) {
        return;
      }
      await this.workspaces.squashInto(project.rootPath, goal);
    } catch (error) {
      if (!this.ctx.closing) {
        this.wait(
          goal,
          `反映できませんでした: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
      return;
    }

    store.transaction(() => {
      store.goals.setStatus(goalId, 'review');
      store.goals.setWaitReason(goalId, null);
    });
    this.ctx.record(
      { type: 'goal', id: goalId },
      'system',
      `ゲームを起動するディレクトリに反映しました（${goal.branch} の変更を、コミットしない変更として置きました）`,
    );
    this.ctx.changed();
    notifyGoalReview(this.ctx, goal, store.tasks.listByGoal(goalId), false);
  }

  /** 反映待ちにする。理由が変わったときだけ記録し、必要なら知らせる */
  private wait(goal: Goal, reason: string, notify: boolean): void {
    const { store } = this.ctx;
    const changed = goal.status !== 'waiting' || goal.waitReason !== reason;
    store.transaction(() => {
      store.goals.setStatus(goal.id, 'waiting');
      store.goals.setWaitReason(goal.id, reason);
    });
    if (!changed) {
      this.ctx.changed();
      return;
    }
    this.ctx.record(
      { type: 'goal', id: goal.id },
      'system',
      `反映待ち: ${reason}`,
    );
    this.ctx.changed();
    if (notify) {
      this.ctx.notify({
        kind: 'goalWaiting',
        title: `反映できません: ${goal.title}`,
        body: reason,
        target: {
          type: 'showGoal',
          projectId: goal.projectId,
          goalId: goal.id,
          taskId: null,
        },
      });
    }
  }

  /** 競合を解く編集タスクを、目標のすべてのタスクの後に追加する */
  private addConflictTask(goal: Goal, conflicts: string[]): void {
    const { store } = this.ctx;
    const tasks = store.tasks.listByGoal(goal.id);
    const id = randomUUID();
    store.transaction(() => {
      store.tasks.insert(
        {
          id,
          goalId: goal.id,
          number: tasks.length + 1,
          title: `競合の解消: ${goal.baseBranch} の変更の取り込み`,
          description: conflictDescription(goal, conflicts),
          kind: 'edit',
          // 両方の変更を読み解く必要があるため、重くする（2026-10-25 決定）
          weight: 'heavy',
          profileId: null,
          runInfo: null,
          status: 'todo',
          paused: false,
          latest: null,
          result: null,
          needsGameRestart: false,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
        tasks.map((t) => t.id),
      );
      store.goals.setStatus(goal.id, 'active');
      store.goals.setWaitReason(goal.id, null);
    });
    this.ctx.record(
      { type: 'goal', id: goal.id },
      'system',
      `${goal.baseBranch} の変更を取り込んだところ競合したため、競合を解くタスク #${tasks.length + 1} を追加しました`,
      conflicts.join('\n'),
    );
    this.ctx.changed();
    this.onTasksAdded();
  }
}

/** 競合を解くタスクの内容（AI への指示になる） */
function conflictDescription(goal: Goal, conflicts: string[]): string {
  return `分岐元のブランチ ${goal.baseBranch} の新しい変更を、この目標のブランチに取り込んだところ、次のファイルで競合しました。
両方の変更の意図を保つように競合を解消し、競合の印（<<<<<<< ・======= ・>>>>>>>）を残さないでください。可能ならビルドで確かめてください。
コミットは Bridge が行います。

${conflicts.map((file) => `- ${file}`).join('\n')}`;
}

/**
 * 目標を確認待ちにしたことを知らせる。
 * @param fixed 確認中の目標の修正が終わったときか
 */
export function notifyGoalReview(
  ctx: RunnerContext,
  goal: Goal,
  tasks: Task[],
  fixed: boolean,
): void {
  const restart = restartRequiredTasks(goal, tasks);
  const restartText =
    restart.length > 0
      ? `反映にはゲームの再起動が必要です（${restart.map((t) => `#${t.number}`).join('・')}）。`
      : '';
  ctx.notify({
    kind: 'goalReview',
    title: `${fixed ? '修正が終わりました' : 'タスクがすべて終わりました'}: ${goal.title}`,
    body: `ゲーム内や VS Code で動作を確かめてください。${restartText}`,
    target: {
      type: 'showGoal',
      projectId: goal.projectId,
      goalId: goal.id,
      taskId: null,
    },
  });
}
