import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { GameConnectionStatus, Project } from '../../shared/domain';
import type { McpServerConfig } from '../providers/AiProvider';
import { writePrivateJson } from './privateFiles';
import { matchProject, ProjectMatchError } from './matchProject';

const helloSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(1),
  gameInstanceId: z.string().uuid(),
  projectRoot: z.string().max(4096),
  gameDirectory: z.string().max(4096).optional(),
});
const stateSchema = z.object({
  type: z.literal('game_state'),
  gameInstanceId: z.string().uuid(),
  worldAvailable: z.boolean(),
  mcpAvailable: z.boolean(),
  error: z.string().max(512).optional(),
  mcp: z
    .object({
      url: z.string(),
      headers: z
        .object({ Authorization: z.string().regex(/^Bearer [a-f0-9]{64}$/) })
        .strict(),
    })
    .strict()
    .optional(),
});
type Connection = {
  ws: WebSocket;
  projectId: string | null;
  gameInstanceId: string | null;
  lastResponse: number;
  config: McpServerConfig | null;
  timer: NodeJS.Timeout;
};

export class ModConnectionServer {
  private readonly instanceId = randomUUID();
  private readonly token = randomBytes(32).toString('hex');
  private readonly sockets = new Set<Connection>();
  private readonly assigned = new Map<string, Connection>();
  private readonly statuses = new Map<string, GameConnectionStatus>();
  private readonly discoveryErrors = new Map<
    string,
    { message: string; timer: NodeJS.Timeout }
  >();
  private readonly file: string;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private starting: Promise<number> | null = null;
  private closed = false;
  private startupError: string | null = null;

  constructor(
    private readonly projects: () => Project[],
    private readonly changed: () => void,
    directory = path.join(homedir(), '.potamaid'),
  ) {
    this.file = path.join(directory, 'bridge.json');
  }

  start(): Promise<number> {
    this.starting ??= this.listen().catch(async () => {
      this.startupError =
        'Bridge の接続情報を保護・保存できないか、待ち受けを開始できません';
      this.changed();
      this.closed = true;
      await this.cleanup();
      throw new Error(this.startupError);
    });
    return this.starting;
  }

  private async listen(): Promise<number> {
    const server = createServer((_req, res) => res.writeHead(404).end());
    this.server = server;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
    this.wss = wss;
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve((server.address() as AddressInfo).port);
      });
    });
    server.on('upgrade', (req, socket, head) => {
      const expected = Buffer.from(`Bearer ${this.token}`);
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (
        this.closed ||
        req.url !== '/mod' ||
        req.headers.origin !== undefined ||
        ![`127.0.0.1:${port}`, `localhost:${port}`].includes(
          req.headers.host ?? '',
        ) ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws));
    });
    await writePrivateJson(this.file, {
      schemaVersion: 1,
      protocolVersion: 1,
      instanceId: this.instanceId,
      url: `ws://127.0.0.1:${port}/mod`,
      token: this.token,
    });
    if (this.closed) throw new Error('Bridge は終了しています');
    return port;
  }

  snapshot(): Record<string, GameConnectionStatus> {
    return Object.fromEntries(
      this.projects().map((p) => [
        p.id,
        this.startupError
          ? { state: 'error', message: this.startupError }
          : (this.statuses.get(p.id) ??
            (this.discoveryErrors.size
              ? {
                  state: 'error',
                  message: this.discoveryErrors.values().next().value!.message,
                }
              : {
                  state: 'disconnected',
                  message: 'ゲーム未接続',
                })),
      ]),
    );
  }

  configFor(projectId: string): McpServerConfig | null {
    return this.assigned.get(projectId)?.config ?? null;
  }

  private connect(ws: WebSocket): void {
    const connection: Connection = {
      ws,
      projectId: null,
      gameInstanceId: null,
      lastResponse: Date.now(),
      config: null,
      timer: setTimeout(
        () => this.reject(ws, 'hello_timeout', '接続開始の応答がありません'),
        10_000,
      ),
    };
    this.sockets.add(connection);
    let chain = Promise.resolve();
    ws.on('message', (data, binary) => {
      // hello のパス照合を待っている間も、後続の通知を同じ順番で処理する。
      chain = chain
        .then(() =>
          binary
            ? this.reject(
                ws,
                'invalid_message',
                'JSON テキストで送信してください',
              )
            : this.message(connection, data.toString()),
        )
        .catch(() =>
          this.reject(
            ws,
            'invalid_message',
            '通信形式または対象modのパスが不正です',
          ),
        );
    });
    ws.on('pong', () => {
      connection.lastResponse = Date.now();
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      clearTimeout(connection.timer);
      clearInterval(connection.timer);
      this.sockets.delete(connection);
      if (
        connection.projectId &&
        this.assigned.get(connection.projectId) === connection
      ) {
        this.assigned.delete(connection.projectId);
        if (this.statuses.get(connection.projectId)?.state !== 'error')
          this.statuses.delete(connection.projectId);
        this.changed();
      }
    });
  }

  private async message(c: Connection, text: string): Promise<void> {
    const data = JSON.parse(text);
    if (!c.projectId) {
      const hello = helloSchema.safeParse(data);
      if (!hello.success) {
        this.reject(
          c.ws,
          'protocol_mismatch',
          '通信バージョンまたは hello が不正です',
        );
        return;
      }
      let project: Project;
      try {
        project = await matchProject(
          this.projects(),
          hello.data.projectRoot,
          hello.data.gameDirectory,
        );
      } catch (error) {
        if (!(error instanceof ProjectMatchError)) throw error;
        this.recordDiscoveryError(hello.data.gameInstanceId, error.message);
        this.changed();
        this.reject(c.ws, error.code, error.message);
        return;
      }
      if (this.assigned.has(project.id)) {
        this.reject(
          c.ws,
          'game_already_connected',
          'この対象modには別のゲームが接続しています',
        );
        return;
      }
      if (c.ws.readyState !== WebSocket.OPEN || !this.sockets.has(c)) return;
      this.clearDiscoveryError(hello.data.gameInstanceId);
      c.projectId = project.id;
      c.gameInstanceId = hello.data.gameInstanceId;
      this.assigned.set(project.id, c);
      this.statuses.set(project.id, {
        state: 'connected',
        message: '接続中（ワールド未起動）',
      });
      clearTimeout(c.timer);
      c.timer = setInterval(() => {
        if (Date.now() - c.lastResponse > 60_000) {
          c.ws.terminate();
          return;
        }
        c.ws.ping();
      }, 20_000);
      c.ws.send(
        JSON.stringify({
          type: 'welcome',
          protocolVersion: 1,
          projectId: project.id,
        }),
      );
      this.changed();
      return;
    }
    c.lastResponse = Date.now();
    if (data.type === 'ping') {
      c.ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    const parsed = stateSchema.safeParse(data);
    if (!parsed.success || parsed.data.gameInstanceId !== c.gameInstanceId) {
      this.reject(c.ws, 'invalid_state', 'ゲーム状態の形式が不正です');
      return;
    }
    const state = parsed.data;
    c.config = null;
    if (state.mcpAvailable) {
      if (!state.worldAvailable || !state.mcp || !validMcpUrl(state.mcp.url)) {
        this.reject(c.ws, 'invalid_endpoint', 'ゲーム MCP の接続先が不正です');
        return;
      }
      c.config = { name: 'potamaid_game', ...state.mcp };
    }
    // 任意の受信文を表示せず、既知の理由だけを UI へ渡す。
    const reasons = [
      'ゲーム MCP が設定で無効です',
      'ゲーム MCP のポートが使用中です',
      'ゲーム MCP の接続設定を保護・読み書きできないか、設定が不正です',
    ];
    this.statuses.set(
      c.projectId,
      state.error
        ? {
            state: 'error',
            message: reasons.includes(state.error)
              ? state.error
              : 'ゲーム MCP を利用できません',
          }
        : c.config
          ? { state: 'available', message: 'ゲーム情報取得可能' }
          : {
              state: 'connected',
              message: state.worldAvailable
                ? '接続中（ゲーム MCP は利用できません）'
                : '接続中（ワールド未起動）',
            },
    );
    this.changed();
  }

  private reject(ws: WebSocket, code: string, message: string): void {
    const c = [...this.sockets].find((s) => s.ws === ws);
    if (c?.projectId && this.assigned.get(c.projectId) === c) {
      c.config = null;
      this.statuses.set(c.projectId, { state: 'error', message });
      this.changed();
    }
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'error', code, message }));
    ws.close(1008);
    setTimeout(() => ws.terminate(), 1000).unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.starting?.catch(() => undefined);
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    for (const c of this.sockets) {
      clearTimeout(c.timer);
      clearInterval(c.timer);
      c.ws.terminate();
    }
    this.assigned.clear();
    for (const id of this.discoveryErrors.keys()) this.clearDiscoveryError(id);
    this.wss?.close();
    const server = this.server;
    this.server = null;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.instanceId === this.instanceId) await rm(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Bridge の接続情報を削除できません');
    }
  }

  private recordDiscoveryError(id: string, message: string): void {
    this.clearDiscoveryError(id);
    // 終了した未接続ゲームのエラーを、ほかの対象modへ表示し続けない。
    const timer = setTimeout(() => {
      this.clearDiscoveryError(id);
      this.changed();
    }, 60_000);
    timer.unref();
    this.discoveryErrors.set(id, { message, timer });
    if (this.discoveryErrors.size > 32)
      this.clearDiscoveryError(this.discoveryErrors.keys().next().value!);
  }

  private clearDiscoveryError(id: string): void {
    clearTimeout(this.discoveryErrors.get(id)?.timer);
    this.discoveryErrors.delete(id);
  }
}

export function validMcpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/mcp' &&
      !!url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      input === `http://127.0.0.1:${url.port}/mcp`
    );
  } catch {
    return false;
  }
}
