/**
 * Codex（app-server）のプロバイダー（仕様書6章「Codex」）。
 *
 * - 1つの app-server のプロセスで複数のスレッドを扱い、通知はスレッド ID とターン ID で振り分ける
 * - プロセスは必要になったときに起動する。実行中のターンの停止が不明なら再実行を拒否する
 *   （実行中でなければ次に起動し直し、thread/resume で読み込み直す）
 * - 認証は利用者が `codex login` で済ませたものを使い、Bridge ではログインしない
 * - 要求の応答と、ターンの途中の無応答には、設定の時間でタイムアウトを設ける
 */
import type {
  ApprovalResponse,
  ModelOption,
  ProviderStatus,
  Settings,
} from '../../../shared/domain';
import type {
  AiApprovalRequest,
  AiProvider,
  AiSession,
  McpServerConfig,
  SessionOptions,
  TurnHandle,
  TurnHandlers,
  TurnInput,
  TurnResult,
} from '../AiProvider';
import { AppServerClient } from './AppServerClient';
import { JsonRpcError, METHOD_NOT_FOUND } from './JsonRpcConnection';
import { completedItemToEvent, startedItemToActivity } from './mapping';
import { CODEX_PERMISSIONS } from './permissions';
import type { ServerNotification } from './protocol/ServerNotification';
import type { ServerRequest } from './protocol/ServerRequest';
import type { Account } from './protocol/v2/Account';
import type { Model } from './protocol/v2/Model';
import type { ModelListResponse } from './protocol/v2/ModelListResponse';
import type { JsonValue } from './protocol/serde_json/JsonValue';
import type { Turn } from './protocol/v2/Turn';
import {
  toElicitationRequest,
  toElicitationResponse,
  toQuestionRequest,
  toQuestionResponse,
} from './userInput';

export interface CodexProviderOptions {
  getSettings(): Settings;
  /** initialize で伝える Bridge の版 */
  clientVersion: string;
  onLog?(message: string): void;
}

/** 実行中のターンの状態 */
interface ActiveTurn {
  threadId: string;
  turnId: string | null;
  handlers: TurnHandlers;
  cancelRequested: boolean;
  /** 最後の AI の発言（構造化出力の読み取りに使う） */
  lastAgentMessage: string | null;
  /** 発言の ID → ストリームで届いた途中までの文章 */
  streaming: Map<string, string>;
  /** ファイル変更のアイテムの ID → 変更するファイル（承認の表示に使う） */
  fileChanges: Map<string, string[]>;
  /** 最後に Codex から何か届いた時刻（無応答のタイムアウトに使う） */
  lastActivityAt: number;
  /** ユーザーの回答を待っている数。待っている間は無応答の時間を数えない */
  waitingForUser: number;
  startSent: boolean;
  stopTimer: NodeJS.Timeout | null;
  stopResult: TurnResult | null;
  interruptSent: boolean;
  acceptInput(): void;
  finish(result: TurnResult): void;
}

/** 許可・拒否への回答を、Codex の値に変える */
const DECISIONS = {
  allow: 'accept',
  allowForSession: 'acceptForSession',
  deny: 'decline',
} as const;

/** 無応答を確かめる間隔 */
const IDLE_CHECK_INTERVAL_MS = 5000;
/** モデルの一覧を取得するページの数の上限（念のため） */
const MAX_MODEL_PAGES = 10;

export class CodexProvider implements AiProvider {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';

  private client: AppServerClient | null = null;
  private starting: Promise<AppServerClient> | null = null;
  /** いまのプロセスで読み込み済みのスレッド */
  private readonly loadedThreads = new Set<string>();
  /** スレッド ID → 実行中のターン（1スレッドにつき1つ） */
  private readonly turns = new Map<string, ActiveTurn>();
  private idleTimer: NodeJS.Timeout | null = null;
  /** 停止を確認できない場合は、新しいセッションでも実行を再開しない */
  private blockedReason: string | null = null;
  private readonly retiredTurnIds = new Set<string>();
  private clientEpoch = 0;

  constructor(private readonly options: CodexProviderOptions) {}

  async getStatus(): Promise<ProviderStatus> {
    const base = { id: this.id, displayName: this.displayName, models: [] };
    try {
      const client = await this.getClient();
      const { account, requiresOpenaiAuth } = await client.request(
        'account/read',
        { refreshToken: false },
      );
      if (!account && requiresOpenaiAuth) {
        return {
          ...base,
          state: 'notLoggedIn',
          message:
            'ログインしていません。ターミナルで codex login を実行してください',
        };
      }
      return {
        ...base,
        state: 'ready',
        message: account ? describeAccount(account) : '使用できます',
        models: await this.listModels(client),
      };
    } catch (error) {
      return {
        ...base,
        state: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startSession(options: SessionOptions): Promise<AiSession> {
    const client = await this.getClient();
    const response = await client.request(
      'thread/start',
      this.threadParams(options),
    );
    this.assertAvailable();
    this.loadedThreads.add(response.thread.id);
    return this.createSession(response.thread.id, options, {
      model: response.model || null,
      effort: options.effort || response.reasoningEffort,
    });
  }

  async resumeSession(
    sessionId: string,
    options: SessionOptions,
  ): Promise<AiSession> {
    await this.ensureLoaded(sessionId, options);
    return this.createSession(sessionId, options);
  }

  async dispose(): Promise<void> {
    const client = this.client ?? (await this.starting?.catch(() => null));
    this.client = null;
    this.starting = null;
    await client?.dispose();
    if (this.turns.size > 0) {
      this.onExit(new Error('Codex の接続を閉じました'));
    }
    this.loadedThreads.clear();
    this.clientEpoch++;
  }

  /** 選べるモデルの一覧（取得できなければ空） */
  private async listModels(client: AppServerClient): Promise<ModelOption[]> {
    const models: ModelOption[] = [];
    try {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const response: ModelListResponse = await client.request('model/list', {
          cursor,
          includeHidden: false,
        });
        models.push(...response.data.map(toModelOption));
        cursor = response.nextCursor;
        if (!cursor) {
          break;
        }
      }
    } catch (error) {
      this.options.onLog?.(`model/list に失敗しました: ${String(error)}`);
    }
    return models;
  }

  private createSession(
    threadId: string,
    options: SessionOptions,
    actual: { model?: string | null; effort?: string | null } = {},
  ): AiSession {
    return {
      sessionId: threadId,
      ...actual,
      runTurn: (input, handlers) =>
        this.runTurn(threadId, options, input, handlers),
    };
  }

  private runTurn(
    threadId: string,
    options: SessionOptions,
    input: TurnInput,
    handlers: TurnHandlers,
  ): TurnHandle {
    this.assertAvailable();
    if (this.turns.has(threadId)) {
      throw new Error('このセッションは応答中です');
    }
    let resolveResult!: (result: TurnResult) => void;
    const result = new Promise<TurnResult>((resolve) => {
      resolveResult = resolve;
    });
    let finished = false;
    let resolveAccepted!: (accepted: boolean) => void;
    const inputAccepted = new Promise<boolean>((resolve) => {
      resolveAccepted = resolve;
    });
    const turn: ActiveTurn = {
      threadId,
      turnId: null,
      handlers,
      cancelRequested: false,
      lastAgentMessage: null,
      streaming: new Map(),
      fileChanges: new Map(),
      lastActivityAt: Date.now(),
      waitingForUser: 0,
      startSent: false,
      stopTimer: null,
      stopResult: null,
      interruptSent: false,
      acceptInput: () => resolveAccepted(true),
      finish: (value) => {
        if (finished) {
          return;
        }
        finished = true;
        resolveAccepted(false);
        if (turn.stopTimer) clearTimeout(turn.stopTimer);
        if (turn.turnId) this.retiredTurnIds.add(turn.turnId);
        this.turns.delete(threadId);
        this.updateIdleTimer();
        resolveResult(turn.stopResult ?? value);
      },
    };
    this.turns.set(threadId, turn);
    this.updateIdleTimer();

    void (async () => {
      try {
        const client = await this.getClient();
        await this.ensureLoaded(threadId, options);
        this.assertAvailable();
        if (finished) return;
        if (turn.cancelRequested) {
          turn.finish({
            status: 'interrupted',
            finalMessage: null,
            error: null,
          });
          return;
        }
        turn.startSent = true;
        const response = await client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: input.text, text_elements: [] }],
          effort: this.effort(options),
          outputSchema: (input.outputSchema ?? null) as never,
        });
        if (finished) return;
        if (turn.turnId && turn.turnId !== response.turn.id) {
          this.block('Codex の開始応答と通知のターン ID が一致しません');
          turn.finish({
            status: 'failed',
            finalMessage: null,
            error: this.blockedReason,
          });
          return;
        }
        turn.turnId = response.turn.id;
        turn.acceptInput();
        if (turn.cancelRequested) {
          this.sendInterrupt(turn);
        }
      } catch (error) {
        if (finished) return;
        const failure: TurnResult = {
          status: 'failed',
          finalMessage: null,
          error: error instanceof Error ? error.message : String(error),
        };
        if (
          turn.startSent &&
          (!(error instanceof JsonRpcError) || turn.turnId)
        ) {
          // 応答がなくてもサーバー側では開始済みかもしれない。
          this.stopTurn(turn, failure);
        } else {
          turn.finish(failure);
        }
      }
    })();

    return {
      result,
      inputAccepted,
      cancel: async () => {
        if (finished) return;
        this.stopTurn(turn);
        await result;
      },
    };
  }

  private sendInterrupt(turn: ActiveTurn): void {
    if (!turn.turnId || !this.client || turn.interruptSent) {
      return;
    }
    turn.interruptSent = true;
    void this.client
      .request('turn/interrupt', {
        threadId: turn.threadId,
        turnId: turn.turnId,
      })
      .catch((error: unknown) =>
        this.options.onLog?.(`turn/interrupt に失敗しました: ${String(error)}`),
      );
  }

  /** interrupt の応答だけでは枠を空けず、完了通知を期限付きで待つ */
  private stopTurn(turn: ActiveTurn, failure: TurnResult | null = null): void {
    turn.cancelRequested = true;
    turn.stopResult ??= failure;
    if (!turn.startSent) {
      turn.finish({ status: 'interrupted', finalMessage: null, error: null });
      return;
    }
    if (!turn.stopTimer) {
      turn.stopTimer = setTimeout(() => {
        this.block(
          'Codex の停止を確認できません。実行中の Codex を停止してから Bridge を再起動してください',
        );
        turn.stopResult = {
          status: 'failed',
          finalMessage: null,
          error: this.blockedReason,
        };
        turn.finish(turn.stopResult);
      }, this.options.getSettings().requestTimeoutSeconds * 1000);
    }
    this.sendInterrupt(turn);
  }

  private block(reason: string): void {
    if (!this.blockedReason) {
      this.blockedReason = reason;
      this.options.onLog?.(reason);
    }
  }

  private assertAvailable(): void {
    if (this.blockedReason) throw new Error(this.blockedReason);
  }

  /** 実行中のターンがある間だけ、無応答を確かめるタイマーを動かす */
  private updateIdleTimer(): void {
    if (this.turns.size > 0 && !this.idleTimer) {
      this.idleTimer = setInterval(
        () => this.checkIdleTurns(),
        IDLE_CHECK_INTERVAL_MS,
      );
    } else if (this.turns.size === 0 && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Codex から長く何も届かないターンを中止し、失敗にする */
  private checkIdleTurns(): void {
    const minutes = this.options.getSettings().turnIdleTimeoutMinutes;
    const now = Date.now();
    for (const turn of this.turns.values()) {
      if (
        !turn.cancelRequested &&
        turn.waitingForUser === 0 &&
        now - turn.lastActivityAt > minutes * 60_000
      ) {
        const message = `Codex から ${minutes} 分間応答がなかったため中止しました`;
        this.stopTurn(turn, {
          status: 'failed',
          finalMessage: null,
          error: message,
        });
      }
    }
  }

  /** いまのプロセスでスレッドを読み込んでいなければ、thread/resume で読み込む */
  private async ensureLoaded(
    threadId: string,
    options: SessionOptions,
  ): Promise<void> {
    this.assertAvailable();
    if (this.loadedThreads.has(threadId)) {
      return;
    }
    const client = await this.getClient();
    await client.request('thread/resume', {
      threadId,
      ...this.threadParams(options),
      excludeTurns: true,
    });
    this.loadedThreads.add(threadId);
  }

  /** thread/start と thread/resume で共通の設定 */
  private threadParams(options: SessionOptions) {
    return {
      cwd: options.cwd,
      model: this.model(options),
      ...CODEX_PERMISSIONS[options.access],
      developerInstructions: options.instructions ?? null,
      config: mcpServersConfig(options.mcpServers ?? []),
    };
  }

  /** セッションの指定。空なら Codex の設定に従う（Bridge の設定の既定は呼び出し元で決める） */
  private model(options: SessionOptions): string | null {
    return options.model?.trim() || null;
  }

  private effort(options: SessionOptions): string | null {
    return options.effort?.trim() || null;
  }

  /** プロセスを（なければ起動して）返す */
  private getClient(): Promise<AppServerClient> {
    this.assertAvailable();
    if (this.client?.isAlive) {
      return Promise.resolve(this.client);
    }
    if (!this.starting) {
      const epoch = ++this.clientEpoch;
      this.starting = AppServerClient.start({
        executablePath: this.options.getSettings().codexPath,
        clientVersion: this.options.clientVersion,
        requestTimeoutMs: () =>
          this.options.getSettings().requestTimeoutSeconds * 1000,
        onNotification: (notification) => {
          if (epoch === this.clientEpoch) this.onNotification(notification);
        },
        onRequest: (request) =>
          epoch === this.clientEpoch
            ? this.onRequest(request)
            : Promise.reject(new Error('Codex の接続は終了しています')),
        onExit: (error) => {
          if (epoch === this.clientEpoch) this.onExit(error);
        },
        onLog: this.options.onLog,
      })
        .then((client) => {
          this.client = client;
          return client;
        })
        .finally(() => {
          this.starting = null;
        });
    }
    return this.starting;
  }

  private onExit(error: Error): void {
    if (this.turns.size > 0) {
      this.block(
        `${error.message}。停止を確認できないため、実行中の Codex を停止してから Bridge を再起動してください`,
      );
    }
    this.client = null;
    this.loadedThreads.clear();
    for (const turn of this.turns.values()) {
      turn.finish({
        status: 'failed',
        finalMessage: null,
        error: error.message,
      });
    }
  }

  private onNotification(notification: ServerNotification): void {
    const params = notification.params as {
      threadId?: string;
      turnId?: string;
      turn?: { id: string };
    };
    if (notification.method === 'turn/started') {
      const turn = this.turns.get(notification.params.threadId);
      const id = notification.params.turn.id;
      if (turn?.startSent && !turn.turnId && !this.retiredTurnIds.has(id)) {
        turn.turnId = id;
        turn.acceptInput();
        if (turn.cancelRequested) this.sendInterrupt(turn);
      }
    }
    const active = this.findTurn(
      params.threadId,
      params.turnId ?? params.turn?.id,
    );
    if (!active) return;
    active.lastActivityAt = Date.now();

    switch (notification.method) {
      case 'turn/started': {
        // ID の登録は上で行う。旧 ID の通知は共通の照合で除外する。
        break;
      }
      case 'item/started': {
        const turn = this.turns.get(notification.params.threadId);
        const { item } = notification.params;
        if (!turn) {
          break;
        }
        if (item.type === 'fileChange') {
          turn.fileChanges.set(
            item.id,
            item.changes.map((c) => c.path),
          );
        }
        const activity = startedItemToActivity(item);
        if (activity) {
          turn.handlers.onEvent(activity);
        }
        break;
      }
      case 'item/agentMessage/delta': {
        const turn = this.turns.get(notification.params.threadId);
        if (!turn) {
          break;
        }
        const { itemId, delta } = notification.params;
        const text = (turn.streaming.get(itemId) ?? '') + delta;
        turn.streaming.set(itemId, text);
        turn.handlers.onEvent({ type: 'agentMessageDelta', itemId, text });
        break;
      }
      case 'item/completed': {
        const turn = this.turns.get(notification.params.threadId);
        const { item } = notification.params;
        if (!turn) {
          break;
        }
        if (item.type === 'agentMessage') {
          turn.lastAgentMessage = item.text;
          turn.streaming.delete(item.id);
        }
        const event = completedItemToEvent(item);
        if (event) {
          turn.handlers.onEvent(event);
        }
        break;
      }
      case 'error': {
        const turn = this.turns.get(notification.params.threadId);
        const { error, willRetry } = notification.params;
        turn?.handlers.onEvent(
          willRetry
            ? { type: 'activity', text: `再試行しています: ${error.message}` }
            : { type: 'progress', kind: 'error', text: error.message },
        );
        break;
      }
      case 'turn/completed': {
        const turn = this.turns.get(notification.params.threadId);
        turn?.finish(toTurnResult(notification.params.turn, turn));
        break;
      }
      default:
        // それ以外の通知は今は使わない
        break;
    }
  }

  private async onRequest(request: ServerRequest): Promise<unknown> {
    const params = request.params as {
      threadId?: string;
      turnId?: string | null;
    };
    const active = this.findTurn(params.threadId, params.turnId);
    switch (request.method) {
      case 'item/commandExecution/requestApproval': {
        const { params } = request;
        const network = params.networkApprovalContext;
        const response = await this.askUser(active, {
          kind: 'command',
          command:
            params.command ??
            (network ? `ネットワークへの接続: ${network.host}` : null),
          cwd: params.cwd ?? null,
          reason: params.reason ?? null,
          files: [],
          source: null,
          message: null,
          questions: [],
          fields: [],
          url: null,
        });
        return { decision: this.toDecision(active, response) };
      }
      case 'item/fileChange/requestApproval': {
        const { params } = request;
        const response = await this.askUser(active, {
          kind: 'fileChange',
          command: null,
          cwd: null,
          reason: params.reason ?? null,
          files:
            active?.fileChanges.get(params.itemId) ??
            (params.grantRoot ? [params.grantRoot] : []),
          source: null,
          message: null,
          questions: [],
          fields: [],
          url: null,
        });
        return { decision: this.toDecision(active, response) };
      }
      case 'item/tool/requestUserInput': {
        const response = await this.askUser(
          active,
          toQuestionRequest(request.params),
        );
        return toQuestionResponse(response);
      }
      case 'mcpServer/elicitation/request': {
        // null は正式な要求だが、旧ターンからの遅延要求と区別できないため振り分けない。
        if (request.params.turnId === null) {
          this.options.onLog?.(
            'MCP の入力要求をキャンセルしました: turnId がなく対象ターンを特定できません',
          );
        }
        const response = await this.askUser(
          active,
          toElicitationRequest(request.params),
        );
        return !this.canApprove(active)
          ? { action: 'cancel', content: null, _meta: null }
          : toElicitationResponse(response);
      }
      default:
        // 動的なツールの呼び出しなど、Bridge が使わない要求
        throw new JsonRpcError(
          METHOD_NOT_FOUND,
          `PotamAId Bridge は ${request.method} に対応していません`,
        );
    }
  }

  /**
   * 画面にユーザーの対応を求め、回答を待つ。
   * 待っている間は、無応答のタイムアウトの時間を数えない。
   */
  private async askUser(
    turn: ActiveTurn | undefined,
    request: AiApprovalRequest,
  ): Promise<ApprovalResponse> {
    if (!turn || !this.canApprove(turn)) {
      return { decision: 'deny' };
    }
    turn.waitingForUser++;
    try {
      const response = await turn.handlers.onApprovalRequest(request);
      return this.canApprove(turn) ? response : { decision: 'deny' };
    } finally {
      turn.waitingForUser--;
      turn.lastActivityAt = Date.now();
    }
  }

  /** 許可・拒否の回答を Codex の値に変える。中止したターンは取り消しにする */
  private toDecision(
    turn: ActiveTurn | undefined,
    response: ApprovalResponse,
  ): 'accept' | 'acceptForSession' | 'decline' | 'cancel' {
    return !this.canApprove(turn) ? 'cancel' : DECISIONS[response.decision];
  }

  private findTurn(
    threadId?: string,
    turnId?: string | null,
  ): ActiveTurn | undefined {
    const turn = threadId ? this.turns.get(threadId) : undefined;
    return turnId && turn?.turnId === turnId ? turn : undefined;
  }

  private canApprove(turn: ActiveTurn | undefined): boolean {
    return (
      !!turn &&
      !this.blockedReason &&
      !turn.cancelRequested &&
      this.turns.get(turn.threadId) === turn
    );
  }
}

function toTurnResult(turn: Turn, active: ActiveTurn): TurnResult {
  switch (turn.status) {
    case 'interrupted':
      return { status: 'interrupted', finalMessage: null, error: null };
    case 'failed':
      return {
        status: 'failed',
        finalMessage: active.lastAgentMessage,
        error: turn.error?.message ?? 'Codex の実行に失敗しました',
      };
    default:
      return {
        status: 'completed',
        finalMessage: active.lastAgentMessage,
        error: null,
      };
  }
}

function toModelOption(model: Model): ModelOption {
  return {
    id: model.model,
    displayName: model.displayName || model.model,
    description: model.description,
    isDefault: model.isDefault,
    efforts: model.supportedReasoningEfforts.map((e) => ({
      id: e.reasoningEffort,
      description: e.description,
    })),
    defaultEffort: model.defaultReasoningEffort ?? null,
  };
}

function describeAccount(account: Account): string {
  switch (account.type) {
    case 'chatgpt':
      return 'ログイン済み（ChatGPT）';
    case 'apiKey':
      return 'ログイン済み（API キー）';
    default:
      return 'ログイン済み';
  }
}

/**
 * セッションの MCP サーバーを、Codex の設定の上書き（config）にする。
 * キーをドット区切りにすると、利用者が config.toml に書いた MCP サーバーを残したまま追加できる
 */
export function mcpServersConfig(
  servers: McpServerConfig[],
): Record<string, JsonValue> | null {
  if (servers.length === 0) {
    return null;
  }
  return Object.fromEntries(
    servers.map((server) => [
      `mcp_servers.${server.name}`,
      { url: server.url, http_headers: server.headers },
    ]),
  );
}
