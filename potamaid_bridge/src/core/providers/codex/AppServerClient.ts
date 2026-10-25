/**
 * Codex app-server（`codex app-server`）の子プロセスとのやり取り。
 *
 * 標準入出力で JSON-RPC をやり取りし、起動時に initialize → initialized の
 * ハンドシェイクを行う。app-server は実験的な機能でプロトコルが変わる可能性があるため、
 * 型は CLI から生成したもの（protocol/）を使い、このファイルと CodexProvider の外には出さない。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { InitializeParams } from './protocol/InitializeParams';
import type { InitializeResponse } from './protocol/InitializeResponse';
import type { ServerNotification } from './protocol/ServerNotification';
import type { ServerRequest } from './protocol/ServerRequest';
import type { GetAccountParams } from './protocol/v2/GetAccountParams';
import type { GetAccountResponse } from './protocol/v2/GetAccountResponse';
import type { ModelListParams } from './protocol/v2/ModelListParams';
import type { ModelListResponse } from './protocol/v2/ModelListResponse';
import type { ThreadResumeParams } from './protocol/v2/ThreadResumeParams';
import type { ThreadResumeResponse } from './protocol/v2/ThreadResumeResponse';
import type { ThreadStartParams } from './protocol/v2/ThreadStartParams';
import type { ThreadStartResponse } from './protocol/v2/ThreadStartResponse';
import type { TurnInterruptParams } from './protocol/v2/TurnInterruptParams';
import type { TurnInterruptResponse } from './protocol/v2/TurnInterruptResponse';
import type { TurnStartParams } from './protocol/v2/TurnStartParams';
import type { TurnStartResponse } from './protocol/v2/TurnStartResponse';
import { JsonRpcConnection } from './JsonRpcConnection';
import { resolveLaunchCommand } from './resolveExecutable';

/** Bridge が使う要求と、その引数・応答の型 */
interface CodexMethods {
  initialize: { params: InitializeParams; result: InitializeResponse };
  'thread/start': { params: ThreadStartParams; result: ThreadStartResponse };
  'thread/resume': { params: ThreadResumeParams; result: ThreadResumeResponse };
  'turn/start': { params: TurnStartParams; result: TurnStartResponse };
  'turn/interrupt': {
    params: TurnInterruptParams;
    result: TurnInterruptResponse;
  };
  'account/read': { params: GetAccountParams; result: GetAccountResponse };
  'model/list': { params: ModelListParams; result: ModelListResponse };
}

export interface AppServerClientOptions {
  /** 設定の実行ファイルのパス（空なら PATH から探す） */
  executablePath: string;
  clientVersion: string;
  /** 要求の応答を待つ時間（ミリ秒）。呼ぶたびに最新の設定を返す */
  requestTimeoutMs(): number;
  onNotification(notification: ServerNotification): void;
  /** サーバーからの要求（承認など）。戻り値が応答になる */
  onRequest(request: ServerRequest): Promise<unknown>;
  /** プロセスが終わった */
  onExit(error: Error): void;
  onLog?(message: string): void;
}

/** エラーの説明に添える標準エラー出力の行数 */
const STDERR_TAIL_LINES = 20;

export class AppServerClient {
  private readonly stderrTail: string[] = [];
  private exited = false;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: JsonRpcConnection,
    private readonly requestTimeoutMs: () => number,
  ) {}

  /** 子プロセスを起動して、ハンドシェイクを済ませる */
  static async start(
    options: AppServerClientOptions,
  ): Promise<AppServerClient> {
    const command = resolveLaunchCommand(options.executablePath, [
      'app-server',
    ]);
    const child = spawn(command.file, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    });

    const connection = new JsonRpcConnection(
      (line) => {
        if (child.stdin.writable) {
          child.stdin.write(line);
        }
      },
      {
        onNotification: (method, params) =>
          options.onNotification({ method, params } as ServerNotification),
        onRequest: (method, params, id) =>
          options.onRequest({ method, params, id } as ServerRequest),
        onProtocolError: (error) => options.onLog?.(error.message),
      },
    );
    const client = new AppServerClient(
      child,
      connection,
      options.requestTimeoutMs,
    );

    createInterface({ input: child.stdout }).on('line', (line) =>
      connection.handleLine(line),
    );
    createInterface({ input: child.stderr }).on('line', (line) => {
      client.stderrTail.push(line);
      if (client.stderrTail.length > STDERR_TAIL_LINES) {
        client.stderrTail.shift();
      }
      options.onLog?.(`[codex] ${line}`);
    });

    const exited = new Promise<Error>((resolve) => {
      const finish = (error: Error) => {
        if (client.exited) {
          return;
        }
        client.exited = true;
        connection.close(error);
        options.onExit(error);
        resolve(error);
      };
      child.on('error', (error) =>
        finish(new Error(`Codex を起動できませんでした: ${error.message}`)),
      );
      child.on('exit', (code) =>
        finish(
          new Error(
            `Codex のプロセスが終了しました（終了コード ${code ?? '不明'}）${client.describeStderr()}`,
          ),
        ),
      );
    });

    // 起動に失敗した場合は、ハンドシェイクを待たずにエラーにする
    const handshake = connection.request<InitializeResponse>(
      'initialize',
      {
        clientInfo: {
          name: 'potamaid_bridge',
          title: 'PotamAId Bridge',
          version: options.clientVersion,
        },
        capabilities: { experimentalApi: false, requestAttestation: false },
      } satisfies InitializeParams,
      options.requestTimeoutMs(),
    );
    try {
      await Promise.race([
        handshake,
        exited.then((error) => Promise.reject(error)),
      ]);
    } catch (error) {
      // 応答しないまま残らないよう、プロセスを止める
      killTree(child);
      throw error;
    }
    connection.notify('initialized');
    return client;
  }

  request<M extends keyof CodexMethods>(
    method: M,
    params: CodexMethods[M]['params'],
  ): Promise<CodexMethods[M]['result']> {
    return this.connection.request(method, params, this.requestTimeoutMs());
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  /** 子プロセスを止める */
  async dispose(): Promise<void> {
    if (this.exited) {
      return;
    }
    // 標準入力を閉じると app-server は終了する。終わらなければ強制的に止める
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killTree(this.child);
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private describeStderr(): string {
    return this.stderrTail.length > 0 ? `\n${this.stderrTail.join('\n')}` : '';
  }
}

/** 子プロセスを、その子孫も含めて止める（Windows では cmd.exe の先も止める） */
function killTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    });
  } else {
    child.kill();
  }
}
