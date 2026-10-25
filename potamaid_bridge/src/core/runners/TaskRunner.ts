/**
 * タスクの実行（編集タスクはファイルの編集あり、調査タスクは読み取り専用）。
 *
 * 未着手 → 応答中 ⇄ 承認待ち → 完了 の流れを担う。
 * タスクごとに新しいセッションを使い、最初のターンで目標と計画、依存先の結果を添える。
 * 追加の指示が溜まっていれば、同じセッションで続けてターンを実行する。
 * 目標のタスクがすべて完了したら、目標を確認待ちにして知らせる（仕様書3章）。
 */
import type { ProgressOwner } from '../../shared/domain';
import { isGoalWorkFinished, restartRequiredTasks } from '../../shared/goals';
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
import type { AiSession } from '../providers/AiProvider';
import type { RunnerContext } from './RunnerContext';

export const taskRunKey = (taskId: string) => `task:${taskId}`;

export class TaskRunner {
  constructor(private readonly ctx: RunnerContext) {}

  async run(taskId: string): Promise<void> {
    const key = taskRunKey(taskId);
    const owner: ProgressOwner = { type: 'task', id: taskId };
    const { store } = this.ctx;

    this.ctx.beginRun(key);
    try {
      const task = store.tasks.get(taskId);
      const goal = store.goals.get(task.goalId);
      const project = store.projects.find(goal.projectId);
      if (!project) {
        throw new Error('対象modが見つかりません');
      }
      const investigate = task.kind === 'investigate';
      const existingSessionId = store.tasks.getSessionId(taskId);
      let instructions = store.tasks.peekInstructions(taskId);
      store.tasks.update(taskId, {
        status: 'running',
        error: null,
        finishedAt: null,
        startedAt: task.startedAt ?? Date.now(),
      });
      this.ctx.changed();

      const provider = this.ctx.providers.get(goal.providerId);
      const options = {
        cwd: project.rootPath,
        access: investigate
          ? ('readOnly' as const)
          : ('workspaceWrite' as const),
        instructions: investigate
          ? INVESTIGATE_INSTRUCTIONS
          : TASK_INSTRUCTIONS,
        model: goal.model,
        effort: goal.effort,
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
        store.tasks.update(taskId, { sessionId: session.sessionId });
        prompt = buildTaskPrompt(
          goal,
          store.tasks.listByGoal(goal.id),
          task,
          instructions.map((i) => i.text),
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
          this.resetToTodo(
            taskId,
            '中止しました。再開するまで停止します。',
            true,
          );
          return;
        }
        if (result.status === 'failed') {
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

      store.tasks.update(taskId, {
        status: 'done',
        finishedAt: Date.now(),
        latest: null,
      });
      this.ctx.changed();
      this.finishGoalIfDone(goal.id);
    } catch (error) {
      if (!this.ctx.closing) {
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
   * 目標のタスクの作業がすべて終わったら、目標を確認待ちにして知らせる。
   * 確認中の目標の修正が終わったときも、もう一度知らせる。
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
    store.goals.setStatus(goalId, 'review');
    this.ctx.changed();

    const restart = restartRequiredTasks(goal, tasks);
    const restartText =
      restart.length > 0
        ? `反映にはゲームの再起動が必要です（${restart.map((t) => `#${t.number}`).join('・')}）。`
        : '';
    this.ctx.notify({
      kind: 'goalReview',
      title: `${goal.status === 'active' ? 'タスクがすべて終わりました' : '修正が終わりました'}: ${goal.title}`,
      body: `ゲーム内や VS Code で動作を確かめてください。${restartText}`,
      target: {
        type: 'showGoal',
        projectId: goal.projectId,
        goalId,
        taskId: null,
      },
    });
  }
}
