/**
 * 相談の実行（読み取り専用）。
 *
 * 1件の相談で1つのセッションを使い、質問ごとにターンを実行して会話を続ける。
 */
import type { ProgressOwner } from '../../shared/domain';
import { resolveOwnerRun } from '../../shared/runConfig';
import { CONSULT_INSTRUCTIONS } from '../planning/prompts';
import type { AiSession } from '../providers/AiProvider';
import type { RunnerContext } from './RunnerContext';

export const consultRunKey = (consultId: string) => `consult:${consultId}`;

export class ConsultRunner {
  constructor(private readonly ctx: RunnerContext) {}

  async run(consultId: string, text: string): Promise<void> {
    const key = consultRunKey(consultId);
    const owner: ProgressOwner = { type: 'consult', id: consultId };
    const { store } = this.ctx;
    const consult = store.consults.get(consultId);
    const project = store.projects.find(consult.projectId);
    if (!project) {
      throw new Error('対象modが見つかりません');
    }

    this.ctx.beginRun(key);
    try {
      store.consults.setStatus(consultId, 'running', null, Date.now());
      this.ctx.changed();

      const { provider, options: runOptions } = this.ctx.prepareRun(
        resolveOwnerRun(consult, this.ctx.getSettings()),
      );
      const options = {
        cwd: project.rootPath,
        access: 'readOnly' as const,
        instructions: CONSULT_INSTRUCTIONS,
        ...runOptions,
        mcpServers: await this.ctx.mcpServers({
          type: 'project',
          id: consult.projectId,
        }),
      };
      const sessionId = store.consults.getSessionId(consultId);
      let session: AiSession;
      if (sessionId) {
        session = await provider.resumeSession(sessionId, options);
      } else {
        session = await provider.startSession(options);
        store.consults.setSessionId(consultId, session.sessionId);
      }

      const result = await this.ctx.runTurn(
        key,
        owner,
        session,
        { text },
        { projectId: project.id },
      );
      if (this.ctx.closing) {
        return;
      }
      if (result.status === 'interrupted') {
        this.ctx.record(owner, 'system', '中止しました');
        store.consults.setStatus(consultId, 'idle', null, Date.now());
      } else if (result.status === 'failed') {
        this.fail(consultId, result.error ?? 'AI の実行に失敗しました');
        return;
      } else {
        store.consults.setStatus(consultId, 'idle', null, Date.now());
      }
      this.ctx.changed();
    } catch (error) {
      if (!this.ctx.closing) {
        this.fail(
          consultId,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      this.ctx.broker.cancelForOwner(owner);
      this.ctx.endRun(key);
    }
  }

  private fail(consultId: string, message: string): void {
    this.ctx.record({ type: 'consult', id: consultId }, 'error', message);
    this.ctx.store.consults.setStatus(consultId, 'failed', message, Date.now());
    this.ctx.changed();
  }
}
