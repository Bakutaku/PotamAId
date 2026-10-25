/**
 * Bridge の本体の流れ（計画 → 承認 → 実行 → 承認待ち → 確認待ち → 完了）を、
 * 偽のプロバイダーで確かめる。Codex は起動しない。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderStatus } from '../shared/domain';
import { BridgeCore } from './BridgeCore';
import type {
  AiProvider,
  AiSession,
  SessionOptions,
  TurnHandle,
  TurnHandlers,
  TurnInput,
  TurnResult,
} from './providers/AiProvider';
import { BridgeStore } from './store/BridgeStore';

/** 1回のターンで偽の AI が行うこと */
type TurnScript = (turn: {
  input: TurnInput;
  handlers: TurnHandlers;
  signal: AbortSignal;
}) => Promise<TurnResult>;

const completed = (finalMessage: string): TurnResult => ({
  status: 'completed',
  finalMessage,
  error: null,
});

/** 決めておいた順にターンを実行する、偽のプロバイダー */
class FakeProvider implements AiProvider {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  readonly scripts: TurnScript[] = [];
  readonly sessions: SessionOptions[] = [];
  readonly inputs: TurnInput[] = [];
  private count = 0;

  async getStatus(): Promise<ProviderStatus> {
    return {
      id: 'codex',
      displayName: 'Codex',
      state: 'ready',
      message: '',
      models: [],
    };
  }
  async startSession(options: SessionOptions): Promise<AiSession> {
    this.sessions.push(options);
    return this.session(`session-${++this.count}`);
  }
  async resumeSession(sessionId: string): Promise<AiSession> {
    return this.session(sessionId);
  }
  async dispose(): Promise<void> {}

  private session(sessionId: string): AiSession {
    return {
      sessionId,
      runTurn: (input, handlers) => {
        this.inputs.push(input);
        const script = this.scripts.shift();
        if (!script) {
          throw new Error('ターンの台本がありません');
        }
        const controller = new AbortController();
        return {
          result: script({ input, handlers, signal: controller.signal }),
          cancel: async () => controller.abort(),
        };
      },
    };
  }
}

const planJson = JSON.stringify({
  goalTitle: '粉砕機を追加する',
  summary: 'ブロックと処理に分けます',
  tasks: [
    { key: 't1', title: 'ブロック', description: '登録する', dependsOn: [] },
    { key: 't2', title: '処理', description: '粉砕する', dependsOn: ['t1'] },
  ],
});

/** モデルと思考量の指定なし（設定の既定） */
const DEFAULT_RUN = { model: null, effort: null };

/** 承認待ちの、使わない項目の初期値 */
const EMPTY_REQUEST = {
  command: null,
  cwd: null,
  reason: null,
  files: [],
  source: null,
  message: null,
  questions: [],
  fields: [],
  url: null,
};

const resultJson = (needsGameRestart: boolean) =>
  JSON.stringify({ summary: '実装しました', needsGameRestart });

/** 中止されるまで待ち、中断として終わるターン */
const untilCancelled: TurnScript = ({ signal }) =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () =>
      resolve({ status: 'interrupted', finalMessage: null, error: null }),
    );
  });

describe('BridgeCore', () => {
  let dir: string;
  let provider: FakeProvider;
  let core: BridgeCore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'potamaid-bridge-'));
    provider = new FakeProvider();
    core = new BridgeCore({
      databasePath: ':memory:',
      createProviders: () => [provider],
    });
  });

  afterEach(async () => {
    await core.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  const taskByNumber = (n: number) =>
    core.snapshot().tasks.find((t) => t.number === n);

  /** 計画の承認まで進める */
  async function approvedGoal() {
    const project = await core.addProject(dir);
    provider.scripts.push(async () => completed(planJson));
    const goal = await core.createGoal(project.id, '粉砕機を追加したい', {
      model: 'gpt-test',
      effort: 'high',
    });
    await vi.waitFor(() =>
      expect(core.snapshot().goals[0]?.status).toBe('planReview'),
    );
    return { project, goal };
  }

  it('計画を作り、承認するとタスクを依存関係の順に実行する', async () => {
    const { goal } = await approvedGoal();
    expect(core.snapshot().goals[0]?.title).toBe('粉砕機を追加する');
    expect(provider.sessions[0]?.access).toBe('readOnly');

    // タスク #1 は承認を求めてから終わる
    provider.scripts.push(async ({ handlers }) => {
      const response = await handlers.onApprovalRequest({
        ...EMPTY_REQUEST,
        kind: 'command',
        command: 'gradlew runData',
        cwd: dir,
        reason: 'データ生成',
      });
      expect(response.decision).toBe('allow');
      return completed(resultJson(true));
    });
    await core.approvePlan(goal.id);

    await vi.waitFor(() => expect(core.snapshot().approvals).toHaveLength(1));
    expect(taskByNumber(1)?.status).toBe('approval');
    expect(provider.sessions[1]?.access).toBe('workspaceWrite');
    // 目標で選んだモデルと思考量を、計画とタスクの両方で使う
    expect(provider.sessions.map((s) => [s.model, s.effort])).toEqual([
      ['gpt-test', 'high'],
      ['gpt-test', 'high'],
    ]);
    // 最初のターンには目標と計画を添える
    expect(provider.inputs[1]?.text).toContain('粉砕機を追加したい');

    await core.respondApproval(core.snapshot().approvals[0].id, {
      decision: 'allow',
    });
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(taskByNumber(1)?.needsGameRestart).toBe(true);
    // 確認待ちの間は、次のタスクを始めない
    expect(taskByNumber(2)?.status).toBe('todo');

    provider.scripts.push(async () => completed(resultJson(false)));
    await core.markTaskDone(taskByNumber(1)!.id);
    await vi.waitFor(() => expect(taskByNumber(2)?.status).toBe('review'));
    expect(taskByNumber(1)?.status).toBe('done');
  });

  it('中止したタスクは未着手に戻り、セッションを作り直す', async () => {
    const { goal } = await approvedGoal();
    provider.scripts.push(untilCancelled);
    await core.approvePlan(goal.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('running'));

    // 中止したあとは、もう一度順番が回ってきて新しいセッションで始まる
    provider.scripts.push(untilCancelled);
    await core.cancelTask(taskByNumber(1)!.id);
    await vi.waitFor(() => expect(provider.sessions).toHaveLength(3));
    const events = await core.getProgressEvents({
      type: 'task',
      id: taskByNumber(1)!.id,
    });
    expect(events.some((e) => e.text.includes('未着手に戻しました'))).toBe(
      true,
    );
  });

  it('確認待ちのタスクへの追加の指示を、同じセッションで実行する', async () => {
    const { goal } = await approvedGoal();
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.approvePlan(goal.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));

    provider.scripts.push(async () => completed(resultJson(false)));
    await core.sendTaskInstruction(taskByNumber(1)!.id, '処理時間を半分にして');
    await vi.waitFor(() => expect(provider.inputs).toHaveLength(3));
    expect(provider.inputs[2]?.text).toContain('処理時間を半分にして');
    // 新しいセッションは作らない（計画とタスク #1 の2つだけ）
    expect(provider.sessions).toHaveLength(2);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
  });

  async function reviewedTask() {
    const { goal } = await approvedGoal();
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.approvePlan(goal.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    return taskByNumber(1)!;
  }

  it('再開失敗と新規セッションの開始失敗を経ても、未送信の追加指示を再試行に含める', async () => {
    const task = await reviewedTask();
    const resume = vi
      .spyOn(provider, 'resumeSession')
      .mockRejectedValueOnce(new Error('resume failed'));
    await core.sendTaskInstruction(task.id, '未送信の固有指示');
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('failed'));
    expect(taskByNumber(1)?.pendingInstructions).toBe(1);
    const start = vi
      .spyOn(provider, 'startSession')
      .mockRejectedValueOnce(new Error('start failed'));
    await core.retryTask(task.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.error).toBe('start failed'));
    expect(taskByNumber(1)?.pendingInstructions).toBe(1);
    // 保留中の指示だけでは、失敗した開始・再開を自動で繰り返さない。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.retryTask(task.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(
      provider.inputs.filter((input) =>
        input.text.includes('未送信の固有指示'),
      ),
    ).toHaveLength(1);
    expect(taskByNumber(1)?.pendingInstructions).toBe(0);
    const events = await core.getProgressEvents({ type: 'task', id: task.id });
    expect(
      events.filter((e) => e.kind === 'user' && e.text === '未送信の固有指示'),
    ).toHaveLength(1);
  });

  it.each(['throw', 'notAccepted'] as const)(
    'ターンの送信失敗でも未送信の指示を保持する（%s）',
    async (failure) => {
      const task = await reviewedTask();
      vi.spyOn(provider, 'resumeSession').mockResolvedValueOnce({
        sessionId: 'failed-send',
        runTurn: () => {
          if (failure === 'throw') throw new Error('send failed');
          return {
            inputAccepted: Promise.resolve(false),
            result: Promise.resolve({
              status: 'failed',
              finalMessage: null,
              error: 'send failed',
            }),
            cancel: async () => {},
          };
        },
      });
      await core.sendTaskInstruction(task.id, '送信失敗でも残す');
      await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('failed'));
      expect(taskByNumber(1)?.pendingInstructions).toBe(1);
      provider.scripts.push(async () => completed(resultJson(false)));
      await core.retryTask(task.id);
      await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
      expect(provider.inputs.at(-1)?.text).toContain('送信失敗でも残す');
      expect(taskByNumber(1)?.pendingInstructions).toBe(0);
    },
  );

  it('受け付けが確定した指示だけ消し、実行中の新しい指示を次のターンに1回渡す', async () => {
    const task = await reviewedTask();
    let accept!: (value: boolean) => void;
    let finish!: (value: TurnResult) => void;
    const firstHandle: TurnHandle = {
      inputAccepted: new Promise((resolve) => {
        accept = resolve;
      }),
      result: new Promise((resolve) => {
        finish = resolve;
      }),
      cancel: async () => {},
    };
    const runTurn = vi
      .fn<AiSession['runTurn']>()
      .mockImplementation((input) => {
        provider.inputs.push(input);
        return {
          inputAccepted: Promise.resolve(true),
          result: Promise.resolve(completed(resultJson(false))),
          cancel: async () => {},
        };
      })
      .mockImplementationOnce((input) => {
        provider.inputs.push(input);
        return firstHandle;
      });
    vi.spyOn(provider, 'resumeSession').mockResolvedValueOnce({
      sessionId: 'delivery',
      runTurn,
    });
    await core.sendTaskInstruction(task.id, '先の追加指示');
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    await core.sendTaskInstruction(task.id, 'あとから来た指示');
    expect(taskByNumber(1)?.pendingInstructions).toBe(2);
    accept(true);
    await vi.waitFor(() =>
      expect(taskByNumber(1)?.pendingInstructions).toBe(1),
    );
    finish(completed(resultJson(false)));
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[0][0].text).toContain('先の追加指示');
    expect(runTurn.mock.calls[0][0].text).not.toContain('あとから来た指示');
    expect(runTurn.mock.calls[1][0].text).toContain('あとから来た指示');
    expect(runTurn.mock.calls[1][0].text).not.toContain('先の追加指示');
    expect(taskByNumber(1)?.pendingInstructions).toBe(0);
  });

  it('ターン開始前に中止された追加指示を削除しない', async () => {
    const task = await reviewedTask();
    let resume!: (session: AiSession) => void;
    const resuming = vi.spyOn(provider, 'resumeSession').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const runTurn = vi.fn<AiSession['runTurn']>();
    await core.sendTaskInstruction(task.id, '開始前の中止でも残す');
    await vi.waitFor(() => expect(resuming).toHaveBeenCalledTimes(1));
    await core.cancelTask(task.id);
    // 未着手へ戻ったあとの自動開始も失敗させ、未送信の保存内容を確認する。
    vi.spyOn(provider, 'startSession').mockRejectedValueOnce(
      new Error('next start failed'),
    );
    resume({ sessionId: 'cancelled-before-start', runTurn });
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('failed'));
    expect(runTurn).not.toHaveBeenCalled();
    expect(taskByNumber(1)?.pendingInstructions).toBe(1);
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.retryTask(task.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(provider.inputs.at(-1)?.text).toContain('開始前の中止でも残す');
  });

  it('受け付け済みの指示は、そのターンが失敗しても再試行へ重複送信しない', async () => {
    const task = await reviewedTask();
    provider.scripts.push(async () => ({
      status: 'failed',
      finalMessage: null,
      error: 'execution failed',
    }));
    await core.sendTaskInstruction(task.id, '受け付け済みの固有指示');
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('failed'));
    expect(taskByNumber(1)?.pendingInstructions).toBe(0);
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.retryTask(task.id);
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(
      provider.inputs.filter((input) =>
        input.text.includes('受け付け済みの固有指示'),
      ),
    ).toHaveLength(1);
    expect(provider.inputs.at(-1)?.text).not.toContain(
      '受け付け済みの固有指示',
    );
  });

  it('失敗時に残った指示は、新しい指示を明示的に送ったときにも再開できる', async () => {
    const task = await reviewedTask();
    vi.spyOn(provider, 'resumeSession').mockRejectedValueOnce(
      new Error('resume failed'),
    );
    await core.sendTaskInstruction(task.id, '残った指示');
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('failed'));
    provider.scripts.push(async () => completed(resultJson(false)));
    await core.sendTaskInstruction(task.id, '新しく送った指示');
    await vi.waitFor(() => expect(taskByNumber(1)?.status).toBe('review'));
    expect(provider.inputs.at(-1)?.text).toContain('残った指示');
    expect(provider.inputs.at(-1)?.text).toContain('新しく送った指示');
    expect(taskByNumber(1)?.pendingInstructions).toBe(0);
  });

  it('計画の作成に失敗したら、やり直せる', async () => {
    const project = await core.addProject(dir);
    provider.scripts.push(async () => completed('JSON ではない'));
    const goal = await core.createGoal(project.id, '目標', DEFAULT_RUN);
    await vi.waitFor(() =>
      expect(core.snapshot().goals[0]?.status).toBe('planFailed'),
    );

    provider.scripts.push(async () => completed(planJson));
    await core.retryPlan(goal.id);
    await vi.waitFor(() =>
      expect(core.snapshot().goals[0]?.status).toBe('planReview'),
    );
  });

  it('循環する依存関係の計画は承認できない', async () => {
    const { goal } = await approvedGoal();
    const [t1, t2] = [taskByNumber(1)!, taskByNumber(2)!];
    await core.updatePlanTask(t1.id, {
      title: t1.title,
      description: t1.description,
      dependsOn: [t2.id],
    });
    await expect(core.approvePlan(goal.id)).rejects.toThrow('循環');
  });

  it('相談は読み取り専用で実行し、発言を途中経過に残す', async () => {
    const project = await core.addProject(dir);
    provider.scripts.push(async ({ handlers }) => {
      handlers.onEvent({ type: 'progress', kind: 'agent', text: '答えです' });
      return completed('答えです');
    });
    const consult = await core.createConsult(
      project.id,
      '質問です',
      DEFAULT_RUN,
    );
    await vi.waitFor(() =>
      expect(core.snapshot().consults[0]?.status).toBe('idle'),
    );
    expect(provider.sessions[0]?.access).toBe('readOnly');
    const events = await core.getProgressEvents({
      type: 'consult',
      id: consult.id,
    });
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ['user', '質問です'],
      ['agent', '答えです'],
    ]);
  });

  it('相談中の AI からの質問を承認待ちに出し、回答を AI に返す', async () => {
    const project = await core.addProject(dir);
    provider.scripts.push(async ({ handlers }) => {
      const response = await handlers.onApprovalRequest({
        ...EMPTY_REQUEST,
        kind: 'question',
        questions: [
          {
            id: 'q1',
            header: '対象',
            question: 'どのブロックですか？',
            options: [{ label: '粉砕機', description: '' }],
            allowOther: true,
            secret: false,
          },
        ],
      });
      expect(response.answers).toEqual({ q1: ['粉砕機'] });
      return completed('わかりました');
    });
    const consult = await core.createConsult(project.id, '質問', DEFAULT_RUN);

    await vi.waitFor(() => expect(core.snapshot().approvals).toHaveLength(1));
    const approval = core.snapshot().approvals[0];
    expect(approval.owner).toEqual({ type: 'consult', id: consult.id });
    // 相談には「承認待ち」の状態はないので、応答中のまま
    expect(core.snapshot().consults[0]?.status).toBe('running');

    await core.respondApproval(approval.id, {
      decision: 'allow',
      answers: { q1: ['粉砕機'] },
    });
    await vi.waitFor(() =>
      expect(core.snapshot().consults[0]?.status).toBe('idle'),
    );
    const events = await core.getProgressEvents({
      type: 'consult',
      id: consult.id,
    });
    expect(events.some((e) => e.text === '対象: 粉砕機')).toBe(true);
  });

  it('中止すると、待っている質問は回答しなかったことにする', async () => {
    const project = await core.addProject(dir);
    provider.scripts.push(async ({ handlers, signal }) => {
      const response = await handlers.onApprovalRequest({
        ...EMPTY_REQUEST,
        kind: 'question',
        questions: [],
      });
      expect(response.decision).toBe('deny');
      expect(signal.aborted).toBe(true);
      return { status: 'interrupted', finalMessage: null, error: null };
    });
    const consult = await core.createConsult(project.id, '質問', DEFAULT_RUN);
    await vi.waitFor(() => expect(core.snapshot().approvals).toHaveLength(1));

    await core.cancelConsult(consult.id);
    await vi.waitFor(() =>
      expect(core.snapshot().consults[0]?.status).toBe('idle'),
    );
    expect(core.snapshot().approvals).toHaveLength(0);
  });
});

describe('BridgeCore の起動時の後片付け', () => {
  it('前回実行中だったタスクを未着手に戻す', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'potamaid-bridge-'));
    const databasePath = path.join(dir, 'bridge.sqlite');
    try {
      const store = new BridgeStore(databasePath);
      store.projects.insert({
        id: 'p',
        name: 'p',
        rootPath: dir,
        readOnlyConcurrency: 2,
        createdAt: 0,
      });
      // 計画を承認していない目標にして、起動しても実行が始まらないようにする
      store.goals.insert({
        id: 'g',
        projectId: 'p',
        title: 'g',
        text: 'g',
        status: 'planReview',
        planSummary: null,
        planError: null,
        providerId: 'codex',
        model: null,
        effort: null,
        createdAt: 0,
      });
      store.tasks.insert(
        {
          id: 't',
          goalId: 'g',
          number: 1,
          title: 't',
          description: '',
          status: 'running',
          latest: '実行中',
          result: null,
          needsGameRestart: false,
          error: null,
          startedAt: 1,
          finishedAt: null,
        },
        [],
      );
      store.tasks.update('t', { sessionId: 'old-session' });
      store.tasks.addInstruction('t', '受け付け前の指示は再起動後も残す', 1);
      store.close();

      const core = new BridgeCore({
        databasePath,
        createProviders: () => [new FakeProvider()],
      });
      const task = core.snapshot().tasks[0];
      expect(task?.status).toBe('todo');
      const events = await core.getProgressEvents({ type: 'task', id: 't' });
      expect(events[0]?.text).toContain('中断しました');
      await core.shutdown();

      const reopened = new BridgeStore(databasePath);
      expect(reopened.tasks.getSessionId('t')).toBeNull();
      expect(reopened.tasks.peekInstructions('t').map((i) => i.text)).toEqual([
        '受け付け前の指示は再起動後も残す',
      ]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
