/**
 * 目標の計画の作成（読み取り専用）。
 *
 * AI に構造化出力で計画を返させ、検証してから下書きのタスクとして保存する。
 * 指示を足して作り直すときは、同じセッションの続きで次のターンを実行する。
 */
import { randomUUID } from 'node:crypto';
import type { ProgressOwner } from '../../shared/domain';
import { PLAN_OUTPUT_SCHEMA, parsePlan } from '../planning/planSchema';
import type { PlanOutput } from '../planning/planSchema';
import {
  PLAN_INSTRUCTIONS,
  buildPlanPrompt,
  buildReplanPrompt,
} from '../planning/prompts';
import type { AiSession } from '../providers/AiProvider';
import type { RunnerContext } from './RunnerContext';

/** 計画の作り方 */
export type PlanRequest =
  | { kind: 'initial' }
  | { kind: 'replan'; instruction: string };

export const planRunKey = (goalId: string) => `plan:${goalId}`;

export class PlanRunner {
  constructor(private readonly ctx: RunnerContext) {}

  async run(goalId: string, request: PlanRequest): Promise<void> {
    const key = planRunKey(goalId);
    const owner: ProgressOwner = { type: 'goal', id: goalId };
    const { store } = this.ctx;
    const goal = store.goals.get(goalId);
    const project = store.projects.find(goal.projectId);
    if (!project) {
      throw new Error('対象modが見つかりません');
    }

    this.ctx.beginRun(key);
    try {
      const provider = this.ctx.providers.get(goal.providerId);
      const options = {
        cwd: project.rootPath,
        access: 'readOnly' as const,
        instructions: PLAN_INSTRUCTIONS,
        model: goal.model,
        effort: goal.effort,
        mcpServers: await this.ctx.mcpServers({ type: 'goal', id: goal.id }),
      };
      const sessionId = store.goals.getPlanSessionId(goalId);
      let session: AiSession;
      let prompt: string;
      if (request.kind === 'replan' && sessionId) {
        session = await provider.resumeSession(sessionId, options);
        prompt = buildReplanPrompt(
          goal,
          request.instruction,
          store.tasks.listByGoal(goalId),
        );
      } else {
        session = await provider.startSession(options);
        store.goals.setPlanSessionId(goalId, session.sessionId);
        prompt =
          request.kind === 'replan'
            ? buildReplanPrompt(
                goal,
                request.instruction,
                store.tasks.listByGoal(goalId),
              )
            : buildPlanPrompt(goal);
      }

      const result = await this.ctx.runTurn(
        key,
        owner,
        session,
        { text: prompt, outputSchema: PLAN_OUTPUT_SCHEMA },
        { projectId: project.id, hideFinalMessage: true },
      );
      if (this.ctx.closing) {
        return;
      }
      if (result.status === 'interrupted') {
        this.fail(goalId, '計画の作成を中止しました');
        return;
      }
      if (result.status === 'failed') {
        this.fail(goalId, result.error ?? '計画の作成に失敗しました');
        return;
      }
      const parsed = parsePlan(result.finalMessage);
      if (!parsed.ok) {
        this.fail(goalId, parsed.error);
        return;
      }
      this.savePlan(goalId, parsed.value);
      this.ctx.record(owner, 'agent', parsed.value.summary);
      this.ctx.changed();
    } catch (error) {
      if (!this.ctx.closing) {
        this.fail(
          goalId,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      this.ctx.broker.cancelForOwner(owner);
      this.ctx.endRun(key);
    }
  }

  /**
   * 計画の作成に失敗したときの状態にする。
   * 前の計画が残っていれば計画の確認に戻し、なければ「計画の失敗」にする。
   */
  fail(goalId: string, message: string): void {
    const { store } = this.ctx;
    const hasTasks = store.tasks.listByGoal(goalId).length > 0;
    store.goals.setStatus(
      goalId,
      hasTasks ? 'planReview' : 'planFailed',
      message,
    );
    this.ctx.record({ type: 'goal', id: goalId }, 'error', message);
    this.ctx.changed();
  }

  /** 計画の下書きを、いまの下書きと入れ替えて保存する */
  private savePlan(goalId: string, plan: PlanOutput): void {
    const { store } = this.ctx;
    store.transaction(() => {
      store.tasks.deleteByGoal(goalId);
      const ids = new Map(plan.tasks.map((t) => [t.key, randomUUID()]));
      plan.tasks.forEach((t, index) => {
        store.tasks.insert(
          {
            id: ids.get(t.key) as string,
            goalId,
            number: index + 1,
            title: t.title,
            description: t.description,
            kind: t.kind,
            status: 'todo',
            paused: false,
            latest: null,
            result: null,
            needsGameRestart: false,
            error: null,
            startedAt: null,
            finishedAt: null,
          },
          t.dependsOn.map((dep) => ids.get(dep) as string),
        );
      });
      if (plan.goalTitle) {
        store.goals.setPlan(goalId, plan.goalTitle, plan.summary);
      }
      store.goals.setStatus(goalId, 'planReview');
    });
  }
}
