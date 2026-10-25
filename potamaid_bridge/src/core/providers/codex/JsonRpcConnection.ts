/**
 * 1行に1つの JSON を送り合う JSON-RPC（Codex app-server の stdio のやり取り）。
 *
 * app-server は JSON-RPC 2.0 の形を使うが、`"jsonrpc": "2.0"` は付けない。
 * 子プロセスとは切り離し、送信の関数と受け取った行だけを扱うことで、
 * プロセスなしで確かめられるようにしている。
 */

export type JsonRpcId = string | number;

interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** 受け取ったメッセージの形（要求・応答・通知のどれか） */
interface IncomingMessage {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** 要求に決めた時間内の応答がなかった */
export class JsonRpcTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(
      `${method} の応答が ${Math.round(timeoutMs / 1000)} 秒ありませんでした`,
    );
  }
}

/** 対応していない要求に返すエラーコード（JSON-RPC の Method not found） */
export const METHOD_NOT_FOUND = -32601;

export interface JsonRpcHandlers {
  /** 相手からの通知 */
  onNotification(method: string, params: unknown): void;
  /** 相手からの要求。戻り値が応答の result になり、例外はエラーの応答になる */
  onRequest(method: string, params: unknown, id: JsonRpcId): Promise<unknown>;
  /** 読めない行など、想定外のこと */
  onProtocolError(error: Error): void;
}

interface PendingRequest {
  method: string;
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closedReason: Error | null = null;

  constructor(
    private readonly send: (line: string) => void,
    private readonly handlers: JsonRpcHandlers,
  ) {}

  /**
   * 要求を送り、応答を待つ。
   * @param timeoutMs この時間に応答がなければ {@link JsonRpcTimeoutError} で失敗する。省略すると待ち続ける
   */
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (this.closedReason) {
      return Promise.reject(this.closedReason);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? null
          : setTimeout(() => {
              if (this.pending.delete(id)) {
                reject(new JsonRpcTimeoutError(method, timeoutMs));
              }
            }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (result) => {
          if (timer) clearTimeout(timer);
          resolve(result as T);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  /** 受け取った1行を処理する */
  handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: IncomingMessage;
    try {
      message = JSON.parse(trimmed) as IncomingMessage;
    } catch {
      this.handlers.onProtocolError(
        new Error(`JSON として読めない行を受け取りました: ${trimmed}`),
      );
      return;
    }

    if (message.method !== undefined && message.id !== undefined) {
      void this.answer(message.id, message.method, message.params);
    } else if (message.method !== undefined) {
      this.handlers.onNotification(message.method, message.params);
    } else if (message.id !== undefined) {
      this.settle(message);
    }
  }

  /** 接続を閉じ、待っている要求をすべて失敗させる */
  close(reason: Error): void {
    this.closedReason = reason;
    for (const request of this.pending.values()) {
      request.reject(reason);
    }
    this.pending.clear();
  }

  private settle(message: IncomingMessage): void {
    const id = message.id as JsonRpcId;
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    this.pending.delete(id);
    if (message.error) {
      request.reject(
        new JsonRpcError(
          message.error.code,
          `${request.method}: ${message.error.message}`,
          message.error.data,
        ),
      );
    } else {
      request.resolve(message.result);
    }
  }

  private async answer(
    id: JsonRpcId,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = await this.handlers.onRequest(method, params, id);
      this.write({ id, result });
    } catch (error) {
      const code =
        error instanceof JsonRpcError ? error.code : METHOD_NOT_FOUND;
      const text = error instanceof Error ? error.message : String(error);
      this.write({ id, error: { code, message: text } });
    }
  }

  private write(message: object): void {
    if (this.closedReason) {
      return;
    }
    this.send(`${JSON.stringify(message)}\n`);
  }
}
