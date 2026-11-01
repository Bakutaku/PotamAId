/**
 * タスクの実行（編集タスクはファイルの編集あり、調査タスクは読み取り専用）。
 *
 * 未着手 → 応答中 ⇄ 承認待ち → 完了 の流れを担う。
 * タスクごとに新しいセッションを使い、最初のターンで目標と計画、依存先の結果を添える。
 * 追加の指示が溜まっていれば、同じセッションで続けてターンを実行する。
 *
 * 進行中の目標のタスクは目標の worktree で実行し、編集タスクが終わるたびに Bridge がコミットする。
 * 確認中・完了の目標の修正は、ゲームを起動するディレクトリで実行する（2026-10-25 決定）。
 * 目標のタスクがすべて完了したら、worktree の目標は反映（{@link GoalIntegrator}）に回し、
 * それ以外は目標を確認待ちにして知らせる（仕様書3章）。
 */
import type { Goal, Project, ProgressOwner, Task } from '../../shared/domain';
import { isGoalWorkFinished, restartRequiredTasks } from '../../shared/goals';
import {
  resolveFollowUpRun,
  resolveOwnerRun,
  resolveTaskRun,
  toRunInfo,
} from '../../shared/runConfig';
import {
  INVESTIGATE_INSTRUCTIONS,
  TASK_INSTRUCTIONS,
  buildFollowUpPrompt,
  buildTaskPrompt,
} from '../planning/prompts';
import {
  INVESTIGATE_RESULT_SCHEMA,
  TASK_RESULT_SCHEMA,
  parseTaskResult,
} from '../planning/taskResultSchema';
import type { GoalWorkspaces } from '../git/GoalWorkspaces';
import type { AiSession } from '../providers/AiProvider';
import { notifyGoalReview, type GoalIntegrator } from './GoalIntegrator';
import type { RunnerContext } from './RunnerContext';

export const taskRunKey = (taskId: string) => `task:${taskId}`;

export class TaskRunner {
  constructor(
    private readonly ctx: RunnerContext,
    private readonly workspaces: GoalWorkspaces,
    private readonly integrator: GoalIntegrator,
  ) {}

  async run(taskId: string): Promise<void> {
    const key = taskRunKey(taskId);
    const owner: ProgressOwner = { type: 'task', id: taskId };
    const { store } = this.ctx;

    this.ctx.beginRun(key);
    /** 編集の結果をコミットする worktree（ゲームを起動するディレクトリで実行するときは null） */
    let commitTo: { path: string; task: Task } | null = null;
    try {
      const task = store.tasks.get(taskId);
      const goal = store.goals.get(task.goalId);
      const project = store.projects.find(goal.projectId);
      if (!project) {
        throw new Error('対象modが見つかりません');
      }
      const investigate = task.kind === 'investigate';
      const workDir = taskWorkDir(goal, project);
      if (!investigate && goal.worktreePath && workDir !== project.rootPath) {
        commitTo = { path: goal.worktreePath, task };
      }
      const existingSessionId = store.tasks.getSessionId(taskId);
      let instructions = store.tasks.peekInstructions(taskId);
      store.tasks.update(taskId, {
        status: 'running',
        error: null,
        finishedAt: null,
        startedAt: task.startedAt ?? Date.now(),
      });
      this.ctx.changed();

      // 追加の指示は同じセッションの続きなので、前回の実行の設定を使う（仕様書6章）
      const settings = this.ctx.getSettings();
      // （実行の設定を記録する前に始めたタスクは、以前と同じく目標の指定で続ける）
      const runConfig = !existingSessionId
        ? resolveTaskRun(task, goal, project, settings)
        : task.runInfo
          ? resolveFollowUpRun(task.runInfo, settings)
          : resolveOwnerRun(goal, settings);
      const { provider, options: runOptions } = this.ctx.prepareRun(runConfig);
      const options = {
        cwd: workDir,
        access: investigate
          ? ('readOnly' as const)
          : ('workspaceWrite' as const),
        instructions: investigate
          ? INVESTIGATE_INSTRUCTIONS
          : TASK_INSTRUCTIONS,
        ...runOptions,
        mcpServers: await this.ctx.mcpServers({ type: 'goal', id: goal.id }),
      };
      const outputSchema = investigate
        ? INVESTIGATE_RESULT_SCHEMA
        : TASK_RESULT_SCHEMA;
      let session: AiSession;
      let prompt: string;
      if (existingSessionId) {
        session = await provider.resumeSession(existingSessionId, options);
        prompt = buildFollowUpPrompt(instructions.map((i) => i.text));
      } else {
        session = await provider.startSession(options);
        store.tasks.update(taskId, {
          sessionId: session.sessionId,
          runInfo: toRunInfo(runConfig, session),
        });
        this.ctx.changed();
        prompt = buildTaskPrompt(
          goal,
          store.tasks.listByGoal(goal.id),
          task,
          instructions.map((i) => i.text),
          workDir !== project.rootPath,
        );
      }

      // どれかのターンが再起動を求めたら、再起動が必要として残す。
      // 同じ作業の区切りで前の実行が求めた再起動も、まだ知らせていないので引き継ぐ
      let needsGameRestart = restartRequiredTasks(goal, [task]).length > 0;
      // 追加の指示がなくなるまで、同じセッションでターンを続ける
      for (;;) {
        const result = await this.ctx.runTurn(
          key,
          owner,
          session,
          { text: prompt, outputSchema },
          {
            projectId: project.id,
            hideFinalMessage: true,
            onInputAccepted: () => {
              store.tasks.acknowledgeInstructions(
                taskId,
                instructions.map((i) => i.id),
              );
              for (const { text } of instructions) {
                this.ctx.record(owner, 'user', text);
              }
              this.ctx.changed();
            },
          },
        );
        if (this.ctx.closing) {
          return;
        }
        if (result.status === 'interrupted') {
          await this.commitPartial(commitTo, '中止');
          this.resetToTodo(
            taskId,
            '中止しました。再開するまで停止します。',
            true,
          );
          return;
        }
        if (result.status === 'failed') {
          await this.commitPartial(commitTo, '失敗');
          this.fail(taskId, result.error ?? 'AI の実行に失敗しました');
          return;
        }

        const report = parseTaskResult(result.finalMessage);
        if (report.summary) {
          this.ctx.record(owner, 'agent', report.summary);
        }
        needsGameRestart ||= !investigate && report.needsGameRestart;
        store.tasks.update(taskId, {
          result: report.summary || null,
          needsGameRestart,
        });

        instructions = store.tasks.peekInstructions(taskId);
        if (instructions.length === 0) {
          break;
        }
        prompt = buildFollowUpPrompt(instructions.map((i) => i.text));
      }

      if (commitTo) {
        // コミットできなければ、次のタスクの変更と混ざらないよう失敗にする
        await this.workspaces.commit(
          commitTo.path,
          commitMessage(commitTo.task),
        );
      }
      store.tasks.update(taskId, {
        status: 'done',
        finishedAt: Date.now(),
        latest: null,
      });
      this.ctx.changed();
      this.finishGoalIfDone(goal.id);
    } catch (error) {
      if (!this.ctx.closing) {
        await this.commitPartial(
          commitTo,
          this.ctx.isCancelRequested(key) ? '中止' : '失敗',
        );
        if (this.ctx.isCancelRequested(key)) {
          this.resetToTodo(
            taskId,
            '中止しました。再開するまで停止します。',
            true,
          );
        } else {
          this.fail(
            taskId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } finally {
      this.ctx.broker.cancelForOwner(owner);
      this.ctx.endRun(key);
    }
  }

  /**
   * 中止・失敗したタスクの途中までの変更をコミットする。
   * 同じ目標の次のタスクのコミットに混ざらないようにするため。失敗しても実行の結果は変えない
   */
  private async commitPartial(
    commitTo: { path: string; task: Task } | null,
    label: string,
  ): Promise<void> {
    if (!commitTo || this.ctx.closing) {
      return;
    }
    try {
      await this.workspaces.commit(
        commitTo.path,
        `${commitMessage(commitTo.task)}（${label}・途中まで）`,
      );
    } catch (error) {
      this.ctx.record(
        { type: 'task', id: commitTo.task.id },
        'error',
        `途中までの変更をコミットできませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 中止と同じ扱いで未着手に戻す。セッションは次回新しく作る */
  resetToTodo(taskId: string, message: string, paused = false): void {
    this.ctx.store.tasks.update(taskId, {
      status: 'todo',
      paused,
      sessionId: null,
      latest: null,
      startedAt: null,
      finishedAt: null,
    });
    this.ctx.record({ type: 'task', id: taskId }, 'system', message);
    this.ctx.changed();
  }

  private fail(taskId: string, message: string): void {
    const { store } = this.ctx;
    store.tasks.update(taskId, {
      status: 'failed',
      paused: false,
      error: message,
      finishedAt: Date.now(),
    });
    this.ctx.record({ type: 'task', id: taskId }, 'error', message);
    this.ctx.changed();

    const task = store.tasks.find(taskId);
    const goal = task && store.goals.find(task.goalId);
    if (task && goal) {
      this.ctx.notify({
        kind: 'taskFailed',
        title: `失敗しました: タスク #${task.number} ${task.title}`,
        body: message,
        target: {
          type: 'showGoal',
          projectId: goal.projectId,
          goalId: goal.id,
          taskId,
        },
      });
    }
  }

  /**
   * 目標のタスクの作業がすべて終わったら、worktree の目標は反映に回す。
   * それ以外（確認中の目標の修正、worktree を持たない以前の目標）は、目標を確認待ちにして知らせる。
   */
  private finishGoalIfDone(goalId: string): void {
    const { store } = this.ctx;
    const goal = store.goals.get(goalId);
    if (goal.status !== 'active' && goal.status !== 'review') {
      return;
    }
    const tasks = store.tasks.listByGoal(goalId);
    if (!isGoalWorkFinished(tasks)) {
      return;
    }
    if (goal.status === 'active' && goal.worktreePath) {
      void this.integrator.request(goalId);
      return;
    }
    store.goals.setStatus(goalId, 'review');
    this.ctx.changed();
    notifyGoalReview(this.ctx, goal, tasks, goal.status === 'review');
  }
}

/**
 * タスクの作業ディレクトリ。
 * 進行中の目標は目標の worktree、確認中・完了の目標の修正はゲームを起動するディレクトリ
 */
export function taskWorkDir(goal: Goal, project: Project): string {
  return goal.status === 'active' && goal.worktreePath && goal.workDir
    ? goal.workDir
    : project.rootPath;
}

/** タスクごとのコミットのメッセージ */
function commitMessage(task: Task): string {
  return `potamaid: #${task.number} ${task.title}`;
}
