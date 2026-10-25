/**
 * タスクの実行（ファイルの編集あり）。
 *
 * 未着手 → 応答中 ⇄ 承認待ち → 確認待ち の流れを担う。
 * タスクごとに新しいセッションを使い、最初のターンで目標と計画を添える。
 * 追加の指示が溜まっていれば、同じセッションで続けてターンを実行する。
 */
import type { ProgressOwner } from '../../shared/domain';
import {
  TASK_INSTRUCTIONS,
  buildFollowUpPrompt,
  buildTaskPrompt,
} from '../planning/prompts';
import {
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
        access: 'workspaceWrite' as const,
        instructions: TASK_INSTRUCTIONS,
        model: goal.model,
        effort: goal.effort,
      };
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

      // 追加の指示がなくなるまで、同じセッションでターンを続ける
      for (;;) {
        const result = await this.ctx.runTurn(
          key,
          owner,
          session,
          { text: prompt, outputSchema: TASK_RESULT_SCHEMA },
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
          this.resetToTodo(taskId, '中止しました。未着手に戻しました。');
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
        store.tasks.update(taskId, {
          result: report.summary || null,
          needsGameRestart: report.needsGameRestart,
        });

        instructions = store.tasks.peekInstructions(taskId);
        if (instructions.length === 0) {
          break;
        }
        prompt = buildFollowUpPrompt(instructions.map((i) => i.text));
      }

      store.tasks.update(taskId, {
        status: 'review',
        finishedAt: Date.now(),
        latest: '動作を確かめてください',
      });
      this.ctx.changed();
    } catch (error) {
      if (!this.ctx.closing) {
        this.fail(
          taskId,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      this.ctx.broker.cancelForOwner(owner);
      this.ctx.endRun(key);
    }
  }

  /** 中止と同じ扱いで未着手に戻す。セッションは次回新しく作る */
  resetToTodo(taskId: string, message: string): void {
    this.ctx.store.tasks.update(taskId, {
      status: 'todo',
      sessionId: null,
      latest: null,
      startedAt: null,
      finishedAt: null,
    });
    this.ctx.record({ type: 'task', id: taskId }, 'system', message);
    this.ctx.changed();
  }

  private fail(taskId: string, message: string): void {
    this.ctx.store.tasks.update(taskId, {
      status: 'failed',
      error: message,
      finishedAt: Date.now(),
    });
    this.ctx.record({ type: 'task', id: taskId }, 'error', message);
    this.ctx.changed();
  }
}
