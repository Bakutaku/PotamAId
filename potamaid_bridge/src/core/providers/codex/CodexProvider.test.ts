/** 偽の app-server のみを使い、実際の AI・子プロセスは起動しない。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalResponse, Settings } from '../../../shared/domain';
import type { TurnHandlers } from '../AiProvider';
import { BridgeCore } from '../../BridgeCore';
import {
  AppServerClient,
  type AppServerClientOptions,
} from './AppServerClient';
import { CodexProvider } from './CodexProvider';
import { JsonRpcError, JsonRpcTimeoutError } from './JsonRpcConnection';
import type { ServerRequest } from './protocol/ServerRequest';
import type { Turn } from './protocol/v2/Turn';

const options = { cwd: '.', access: 'workspaceWrite' as const };
const settings: Settings = {
  theme: null,
  codexPath: '',
  codexModel: '',
  codexEffort: '',
  requestTimeoutSeconds: 2,
  turnIdleTimeoutMinutes: 1,
  desktopNotifications: false,
};
const turnData = (id: string, status: Turn['status'] = 'completed'): Turn => ({
  id,
  status,
  rootTurnId: null,
  items: [],
  itemsView: 'full',
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});

describe('CodexProvider のターンの分離と停止', () => {
  let provider: CodexProvider;
  let callbacks: AppServerClientOptions;
  let number: number;
  let handlers: TurnHandlers;
  const onLog = vi.fn();
  const request =
    vi.fn<(method: string, params: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.useFakeTimers();
    number = 0;
    request.mockReset().mockImplementation(async (method) => {
      if (method === 'thread/start') return { thread: { id: 'thread' } };
      if (method === 'turn/start')
        return { turn: turnData(`turn-${++number}`, 'inProgress') };
      return {};
    });
    vi.spyOn(AppServerClient, 'start').mockImplementation(async (opts) => {
      callbacks = opts;
      return {
        isAlive: true,
        request,
        dispose: async () => callbacks.onExit(new Error('test shutdown')),
      } as unknown as AppServerClient;
    });
    onLog.mockClear();
    provider = new CodexProvider({
      getSettings: () => settings,
      clientVersion: 'test',
      onLog,
    });
    handlers = {
      onEvent: vi.fn(),
      onApprovalRequest: vi.fn(async () => ({ decision: 'allow' as const })),
    };
  });

  afterEach(async () => {
    await provider.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function complete(id: string, status: Turn['status'] = 'completed') {
    callbacks.onNotification({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: turnData(id, status) },
    });
  }

  function approval(turnId: string): ServerRequest {
    return {
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread',
        turnId,
        itemId: 'cmd',
        command: 'test',
        cwd: '.',
        reason: null,
      },
    } as ServerRequest;
  }

  it.each([true, false])(
    '無応答でも完了通知までは結果と同じセッションの枠を保持する（interrupt 応答=%s）',
    async (respond) => {
      const session = await provider.startSession(options);
      const first = session.runTurn({ text: 'first' }, handlers);
      const settled = vi.fn();
      void first.result.then(settled);
      await vi.advanceTimersByTimeAsync(0);
      if (!respond) {
        request.mockImplementation(async (method) =>
          method === 'turn/interrupt' ? new Promise(() => {}) : {},
        );
      }
      await vi.advanceTimersByTimeAsync(65000);
      expect(request).toHaveBeenCalledWith('turn/interrupt', {
        threadId: 'thread',
        turnId: 'turn-1',
      });
      expect(settled).not.toHaveBeenCalled();
      expect(() => session.runTurn({ text: 'overlap' }, handlers)).toThrow(
        '応答中',
      );
      complete('turn-1', 'interrupted');
      expect((await first.result).status).toBe('failed');
    },
  );

  it('停止確認の期限を超えたら失敗し、新旧どのセッションからも再実行しない', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(67000);
    expect(await first.result).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('停止を確認できません'),
    });
    expect(() => session.runTurn({ text: 'second' }, handlers)).toThrow(
      '停止を確認できません',
    );
    await expect(provider.startSession(options)).rejects.toThrow(
      '停止を確認できません',
    );
    await expect(provider.resumeSession('other', options)).rejects.toThrow(
      '停止を確認できません',
    );
    expect((await provider.getStatus()).state).toBe('unavailable');
    complete('turn-1', 'interrupted');
    await provider.dispose();
    await expect(provider.startSession(options)).rejects.toThrow(
      '停止を確認できません',
    );
    expect(
      request.mock.calls.filter(([method]) => method === 'turn/start'),
    ).toHaveLength(1);
  });

  it('ターン ID のない開始タイムアウトでも、無期限に待たず後続を拒否する', async () => {
    const session = await provider.startSession(options);
    request.mockRejectedValue(new JsonRpcTimeoutError('turn/start', 2000));
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first.inputAccepted).toBe(false);
    expect((await first.result).status).toBe('failed');
    await expect(provider.startSession(options)).rejects.toThrow(
      '停止を確認できません',
    );
  });

  it('開始応答が失われても、開始通知と停止完了が届けば安全に終了できる', async () => {
    const session = await provider.startSession(options);
    request.mockImplementation(async (method) => {
      if (method === 'turn/start') {
        callbacks.onNotification({
          method: 'turn/started',
          params: {
            threadId: 'thread',
            turn: turnData('notified', 'inProgress'),
          },
        });
        throw new JsonRpcTimeoutError(method, 2000);
      }
      return {};
    });
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(await first.inputAccepted).toBe(true);
    expect(request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread',
      turnId: 'notified',
    });
    complete('notified', 'interrupted');
    expect((await first.result).status).toBe('failed');
    await expect(
      provider.resumeSession('thread', options),
    ).resolves.toBeDefined();
  });

  it('開始を明示的に拒否された入力は未送信として返し、再実行できる', async () => {
    const session = await provider.startSession(options);
    request.mockRejectedValueOnce(new JsonRpcError(-1, 'start rejected'));
    const first = session.runTurn({ text: 'first' }, handlers);
    expect(await first.inputAccepted).toBe(false);
    expect((await first.result).status).toBe('failed');
    await expect(
      provider.resumeSession('thread', options),
    ).resolves.toBeDefined();
  });

  it('開始タイムアウト後に届いた開始通知からも停止し、確認できるまで枠を保持する', async () => {
    const session = await provider.startSession(options);
    request.mockRejectedValueOnce(new JsonRpcTimeoutError('turn/start', 2000));
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    callbacks.onNotification({
      method: 'turn/started',
      params: {
        threadId: 'thread',
        turn: turnData('late-start', 'inProgress'),
      },
    });
    expect(await first.inputAccepted).toBe(true);
    expect(request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread',
      turnId: 'late-start',
    });
    complete('late-start', 'interrupted');
    expect((await first.result).status).toBe('failed');
    await expect(
      provider.resumeSession('thread', options),
    ).resolves.toBeDefined();
  });

  it('開始処理中の中止は turn/start を送らず、入力を未送信として返す', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await first.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(await first.inputAccepted).toBe(false);
    expect((await first.result).status).toBe('interrupted');
    expect(request.mock.calls.some(([method]) => method === 'turn/start')).toBe(
      false,
    );
  });

  it('実行中の中止にも停止確認の期限があり、承認を取り消す', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    const cancelled = first.cancel();
    expect(await callbacks.onRequest(approval('turn-1'))).toEqual({
      decision: 'cancel',
    });
    expect(handlers.onApprovalRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await cancelled;
    expect((await first.result).status).toBe('failed');
  });

  it('旧ターンの開始・完了・アイテム・エラー・承認・質問・MCP 入力を新ターンに渡さない', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(65000);
    complete('turn-1', 'interrupted');
    await first.result;
    const second = session.runTurn({ text: 'second' }, handlers);
    // 新しい開始応答より先に届く、旧ターンの通知も無視する。
    callbacks.onNotification({
      method: 'turn/started',
      params: { threadId: 'thread', turn: turnData('turn-1', 'inProgress') },
    });
    await vi.advanceTimersByTimeAsync(0);
    const settled = vi.fn();
    void second.result.then(settled);
    complete('turn-1', 'interrupted');
    callbacks.onNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread',
        turnId: 'turn-1',
        itemId: 'msg',
        delta: 'old',
      },
    });
    callbacks.onNotification({
      method: 'item/started',
      params: {
        threadId: 'thread',
        turnId: 'turn-1',
        startedAtMs: 0,
        item: {
          type: 'agentMessage',
          id: 'msg',
          text: 'old',
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });
    callbacks.onNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread',
        turnId: 'turn-1',
        completedAtMs: 0,
        item: {
          type: 'agentMessage',
          id: 'msg',
          text: 'old',
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });
    callbacks.onNotification({
      method: 'error',
      params: {
        threadId: 'thread',
        turnId: 'turn-1',
        error: {
          message: 'old',
          codexErrorInfo: null,
          additionalDetails: null,
          misalignment: null,
        },
        willRetry: false,
      },
    });
    expect(await callbacks.onRequest(approval('turn-1'))).toEqual({
      decision: 'cancel',
    });
    expect(
      await callbacks.onRequest({
        ...approval('turn-1'),
        method: 'item/fileChange/requestApproval',
      } as ServerRequest),
    ).toEqual({ decision: 'cancel' });
    expect(
      await callbacks.onRequest({
        id: 2,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: 'thread',
          turnId: 'turn-1',
          itemId: 'q',
          questions: [],
          isBlocking: true,
          autoResolutionMs: null,
        },
      }),
    ).toEqual({ answers: {} });
    for (const turnId of ['turn-1', null]) {
      expect(
        await callbacks.onRequest({
          id: 3,
          method: 'mcpServer/elicitation/request',
          params: {
            threadId: 'thread',
            turnId,
            serverName: 'mcp',
            mode: 'url',
            message: 'old',
            url: 'https://example.test',
            elicitationId: 'e',
            _meta: null,
          },
        }),
      ).toMatchObject({ action: 'cancel' });
    }
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('turnId がなく対象ターンを特定できません'),
    );
    expect(handlers.onApprovalRequest).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(await callbacks.onRequest(approval('turn-2'))).toEqual({
      decision: 'accept',
    });
    expect(
      await callbacks.onRequest({
        id: 4,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thread',
          turnId: 'turn-2',
          serverName: 'mcp',
          mode: 'url',
          message: 'current',
          url: 'https://example.test',
          elicitationId: 'e',
          _meta: null,
        },
      }),
    ).toMatchObject({ action: 'accept' });
    callbacks.onNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread',
        turnId: 'turn-2',
        completedAtMs: 0,
        item: {
          type: 'agentMessage',
          id: 'new',
          text: 'new',
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });
    complete('turn-2');
    expect(await second.result).toMatchObject({
      status: 'completed',
      finalMessage: 'new',
    });
  });

  it('古い承認への遅い回答を、新ターンの許可として使わない', async () => {
    let answer!: (response: ApprovalResponse) => void;
    handlers.onApprovalRequest = vi.fn(
      () =>
        new Promise<ApprovalResponse>((resolve) => {
          answer = resolve;
        }),
    );
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    const response = callbacks.onRequest(approval('turn-1'));
    complete('turn-1');
    await first.result;
    const second = session.runTurn({ text: 'second' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    answer({ decision: 'allowForSession' });
    expect(await response).toEqual({ decision: 'cancel' });
    complete('turn-2');
    await second.result;
  });

  it('旧ターンの通知で、新ターンの無応答の期限を延長しない', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    complete('turn-1');
    await first.result;
    const second = session.runTurn({ text: 'second' }, handlers);
    await vi.advanceTimersByTimeAsync(60000);
    callbacks.onNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread',
        turnId: 'turn-1',
        itemId: 'old',
        delta: 'old',
      },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread',
      turnId: 'turn-2',
    });
    complete('turn-2', 'interrupted');
    await second.result;
  });

  it('接続を閉じたあとの旧接続の通知・要求・終了で、新しい実行を変更しない', async () => {
    const session = await provider.startSession(options);
    const first = session.runTurn({ text: 'first' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    complete('turn-1');
    await first.result;
    const oldConnection = callbacks;
    await provider.dispose();
    const resumed = await provider.resumeSession('thread', options);
    expect(request).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ threadId: 'thread' }),
    );
    const second = resumed.runTurn({ text: 'second' }, handlers);
    await vi.advanceTimersByTimeAsync(0);
    const settled = vi.fn();
    void second.result.then(settled);
    oldConnection.onExit(new Error('late exit'));
    oldConnection.onNotification({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: turnData('turn-2') },
    });
    await expect(oldConnection.onRequest(approval('turn-2'))).rejects.toThrow(
      '接続は終了',
    );
    expect(settled).not.toHaveBeenCalled();
    complete('turn-2');
    expect((await second.result).status).toBe('completed');
  });

  it('同じ対象modの次タスクを停止確認前には開始せず、期限後も Codex へ送らない', async () => {
    const core = new BridgeCore({
      databasePath: ':memory:',
      createProviders: () => [provider],
    });
    try {
      const project = await core.addProject(process.cwd());
      const goal = await core.createGoal(project.id, 'goal', {
        model: null,
        effort: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      callbacks.onNotification({
        method: 'item/completed',
        params: {
          threadId: 'thread',
          turnId: 'turn-1',
          completedAtMs: 0,
          item: {
            type: 'agentMessage',
            id: 'plan',
            phase: null,
            memoryCitation: null,
            delivery: null,
            questions: null,
            text: JSON.stringify({
              goalTitle: 'g',
              summary: 'plan',
              tasks: [
                {
                  key: 'a',
                  title: 'first',
                  description: 'first',
                  kind: 'edit',
                  dependsOn: [],
                },
                {
                  key: 'b',
                  title: 'second',
                  description: 'second',
                  kind: 'edit',
                  dependsOn: [],
                },
              ],
            }),
          },
        },
      });
      complete('turn-1');
      await vi.advanceTimersByTimeAsync(0);
      await core.approvePlan(goal.id);
      await vi.advanceTimersByTimeAsync(65000);
      expect(core.snapshot().tasks.map((task) => task.status)).toEqual([
        'running',
        'todo',
      ]);
      expect(core.snapshot().runs[project.id].edit).toBe(1);
      expect(
        request.mock.calls.filter(([method]) => method === 'turn/start'),
      ).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(core.snapshot().tasks.map((task) => task.status)).toEqual([
        'failed',
        'failed',
      ]);
      expect(
        request.mock.calls.filter(([method]) => method === 'turn/start'),
      ).toHaveLength(2);
    } finally {
      await core.shutdown();
    }
  });
});
