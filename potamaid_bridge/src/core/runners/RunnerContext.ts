/**
 * 計画・タスク・相談の実行で共通して使うもの。
 *
 * - 途中経過の保存と通知
 * - 実行中のターンの登録と中止（ターンが始まる前の中止にも対応する）
 * - 承認の待ち（許可・AI からの質問・MCP の入力要求）の登録と回答の記録
 */
import { randomUUID } from 'node:crypto';
import type {
  Approval,
  ApprovalResponse,
  ProgressEvent,
  ProgressKind,
  ProgressOwner,
} from '../../shared/domain';
import { describeApproval, isPermissionRequest } from '../../shared/approvals';
import type { StreamingText, UiCommand } from '../../shared/ipc';
import type { ApprovalBroker } from '../ApprovalBroker';
import type { TypedEmitter } from '../events';
import type { BridgeMcpServer, SessionScope } from '../mcp/BridgeMcpServer';
import type {
  AiApprovalRequest,
  AiSession,
  McpServerConfig,
  TurnHandle,
  TurnInput,
  TurnResult,
} from '../providers/AiProvider';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { BridgeStore } from '../store/BridgeStore';

/** Bridge の本体が発行するイベント */
export interface CoreEvents extends Record<string, unknown> {
  /** 状態が変わった（画面はまとめて取り直す） */
  changed: undefined;
  progress: ProgressEvent;
  streaming: StreamingText;
  notification: BridgeNotification;
}

/** ユーザーの対応が必要になったことの知らせ（仕様書3章「通知」）。デスクトップ通知に使う */
export interface BridgeNotification {
  kind: 'goalReview' | 'approval' | 'taskFailed';
  title: string;
  body: string;
  /** 通知を選んだときに画面で開くもの */
  target: UiCommand;
}

/** ボードのカードに出す「最新の途中経過」の最大の長さ */
const LATEST_MAX_LENGTH = 80;

/** 実行の識別子（タスク・相談・計画づくり）。順番待ちと中止に使う */
export function runKeyOf(owner: ProgressOwner): string {
  return `${owner.type === 'goal' ? 'plan' : owner.type}:${owner.id}`;
}

interface ActiveRun {
  handle: TurnHandle | null;
  cancelRequested: boolean;
}

export interface TurnOptions {
  /** 入力が AI に受け付けられたときに1回だけ呼ぶ */
  onInputAccepted?(): void;
  /** 承認の待ちに付ける対象mod */
  projectId: string;
  /**
   * 最後の発言を途中経過に出さない。
   * 構造化出力（JSON）の発言はそのまま見せず、呼び出し元が読みやすくして記録するため。
   */
  hideFinalMessage?: boolean;
}

export class RunnerContext {
  /** 終了の処理中。実行の結果で状態を書き換えない（次の起動で中断として扱う） */
  closing = false;

  private readonly runs = new Map<string, ActiveRun>();

  constructor(
    readonly store: BridgeStore,
    readonly providers: ProviderRegistry,
    readonly broker: ApprovalBroker,
    readonly emitter: TypedEmitter<CoreEvents>,
    private readonly mcp: BridgeMcpServer,
  ) {}

  /** セッションに渡す MCP サーバー（Bridge のツール）。使えなければ空 */
  async mcpServers(scope: SessionScope): Promise<McpServerConfig[]> {
    const config = await this.mcp.configFor(scope);
    return config ? [config] : [];
  }

  /** 状態が変わったことを知らせる */
  changed(): void {
    this.emitter.emit('changed', undefined);
  }

  /** ユーザーの対応が必要になったことを知らせる */
  notify(notification: BridgeNotification): void {
    this.emitter.emit('notification', notification);
  }

  /** 通知に出す、途中経過の持ち主の名前（「タスク #1 ブロック」など） */
  describeOwner(owner: ProgressOwner): string {
    switch (owner.type) {
      case 'task': {
        const task = this.store.tasks.find(owner.id);
        return task ? `タスク #${task.number} ${task.title}` : 'タスク';
      }
      case 'goal':
        return `計画: ${this.store.goals.find(owner.id)?.title ?? '目標'}`;
      case 'consult':
        return `相談: ${this.store.consults.find(owner.id)?.title ?? ''}`;
    }
  }

  /** 途中経過を保存して知らせる */
  record(
    owner: ProgressOwner,
    kind: ProgressKind,
    text: string,
    detail: string | null = null,
  ): void {
    const event = this.store.events.append({
      ownerType: owner.type,
      ownerId: owner.id,
      kind,
      text,
      detail,
      createdAt: Date.now(),
    });
    this.emitter.emit('progress', event);
    if (owner.type === 'task' && kind !== 'user') {
      this.setActivity(owner, text);
    }
  }

  /** タスクの「最新の途中経過」を更新する */
  setActivity(owner: ProgressOwner, text: string): void {
    if (owner.type !== 'task') {
      return;
    }
    const firstLine = text.split('\n')[0] ?? '';
    const latest =
      firstLine.length > LATEST_MAX_LENGTH
        ? `${firstLine.slice(0, LATEST_MAX_LENGTH)}…`
        : firstLine;
    this.store.tasks.update(owner.id, { latest });
    this.changed();
  }

  /** 実行を始める。終わったら必ず {@link endRun} を呼ぶ */
  beginRun(key: string): void {
    this.runs.set(key, { handle: null, cancelRequested: false });
  }

  endRun(key: string): void {
    this.runs.delete(key);
  }

  isRunning(key: string): boolean {
    return this.runs.has(key);
  }

  isCancelRequested(key: string): boolean {
    return this.runs.get(key)?.cancelRequested ?? false;
  }

  /** 実行中のターンを中止する。実行中でなければ false */
  requestCancel(key: string): boolean {
    const run = this.runs.get(key);
    if (!run) {
      return false;
    }
    run.cancelRequested = true;
    void run.handle?.cancel();
    return true;
  }

  /** 実行中のものをすべて中止する */
  cancelAllRuns(): void {
    for (const key of this.runs.keys()) {
      this.requestCancel(key);
    }
  }

  /** 1回のターンを実行し、途中経過を記録しながら終わるのを待つ */
  async runTurn(
    key: string,
    owner: ProgressOwner,
    session: AiSession,
    input: TurnInput,
    options: TurnOptions,
  ): Promise<TurnResult> {
    const run = this.runs.get(key);
    if (this.closing || !run || run.cancelRequested) {
      return { status: 'interrupted', finalMessage: null, error: null };
    }

    // AI の発言は、次の途中経過が届くまで記録を遅らせる（最後の発言を出さないため）
    let pendingAgentMessage: string | null = null;
    const flush = () => {
      if (pendingAgentMessage !== null) {
        this.record(owner, 'agent', pendingAgentMessage);
        pendingAgentMessage = null;
      }
    };

    const handle = session.runTurn(input, {
      onEvent: (event) => {
        switch (event.type) {
          case 'progress':
            flush();
            if (event.kind === 'agent' && options.hideFinalMessage) {
              pendingAgentMessage = event.text;
            } else {
              this.record(owner, event.kind, event.text, event.detail ?? null);
            }
            break;
          case 'activity':
            this.setActivity(owner, event.text);
            break;
          case 'agentMessageDelta':
            this.emitter.emit('streaming', {
              owner,
              itemId: event.itemId,
              text: event.text,
            });
            break;
        }
      },
      onApprovalRequest: (request) =>
        this.waitForApproval(owner, options.projectId, request),
    });
    run.handle = handle;
    if (run.cancelRequested) {
      void handle.cancel();
    }

    if (await (handle.inputAccepted ?? Promise.resolve(true))) {
      options.onInputAccepted?.();
    }
    const result = await handle.result;
    run.handle = null;
    const isFinal =
      result.status === 'completed' &&
      pendingAgentMessage !== null &&
      pendingAgentMessage === result.finalMessage;
    if (!isFinal) {
      flush();
    }
    return run.cancelRequested && result.status === 'completed'
      ? { status: 'interrupted', finalMessage: null, error: null }
      : result;
  }

  /**
   * 承認の待ちを登録し、回答を待つ。
   * タスクは待っている間「承認待ち」にする。相談と計画づくりは状態を変えず、承認待ちの枠に出す。
   */
  private async waitForApproval(
    owner: ProgressOwner,
    projectId: string,
    request: AiApprovalRequest,
  ): Promise<ApprovalResponse> {
    const approval: Approval = {
      id: randomUUID(),
      projectId,
      owner,
      ...request,
      createdAt: Date.now(),
    };
    const what = describeApproval(request);
    if (owner.type === 'task') {
      this.store.tasks.update(owner.id, {
        status: 'approval',
        latest: `承認待ち: ${what}`,
      });
    }
    const pending = this.broker.request(approval);
    this.changed();
    this.notify({
      kind: 'approval',
      title: `承認待ち: ${this.describeOwner(owner)}`,
      body: what,
      target: { type: 'showApprovals', projectId },
    });

    const response = await pending;

    if (!this.closing && !this.isCancelRequested(runKeyOf(owner))) {
      if (owner.type === 'task') {
        this.store.tasks.update(owner.id, { status: 'running' });
      }
      this.recordResponse(owner, request, what, response);
    }
    this.changed();
    return response;
  }

  /** 回答を途中経過に残す（秘密の回答は残さない） */
  private recordResponse(
    owner: ProgressOwner,
    request: AiApprovalRequest,
    what: string,
    response: ApprovalResponse,
  ): void {
    if (response.decision === 'deny') {
      const label = isPermissionRequest(request)
        ? '拒否しました'
        : '回答しませんでした';
      this.record(owner, 'system', `${what}: ${label}`);
      return;
    }
    if (request.kind === 'question') {
      for (const question of request.questions) {
        const answer = response.answers?.[question.id] ?? [];
        this.record(
          owner,
          'user',
          `${question.header || question.question}: ${question.secret ? '（非表示）' : answer.join('、')}`,
        );
      }
      return;
    }
    const label =
      request.kind === 'form' || request.kind === 'url'
        ? '回答しました'
        : response.decision === 'allowForSession'
          ? 'このセッションの間は許可しました'
          : '許可しました';
    this.record(owner, 'system', `${what}: ${label}`);
  }
}
