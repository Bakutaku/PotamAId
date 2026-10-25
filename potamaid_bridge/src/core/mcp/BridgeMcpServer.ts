/**
 * Bridge の MCP サーバー（仕様書5章「Bridge の MCP ツール」）。
 *
 * Bridge が実行する AI のセッションに、目標やタスクを調べるツールを渡す。
 * プロバイダーに依存しないよう、MCP の Streamable HTTP で localhost にだけ公開する。
 *
 * - 起動ごとに作る秘密のトークンを Authorization ヘッダーで確かめる
 * - URL のパスでセッションの範囲（対象mod、または目標）を表す
 * - リクエストごとに MCP サーバーを作る（状態を持たない）
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpServerConfig } from '../providers/AiProvider';
import type { BridgeStore } from '../store/BridgeStore';
import {
  BRIDGE_MCP_SERVER_NAME,
  BridgeTools,
  ToolError,
  type ToolScope,
} from './bridgeTools';

/** セッションの範囲。目標の範囲は、その目標の対象modも含む */
export type SessionScope =
  | { type: 'project'; id: string }
  | { type: 'goal'; id: string };

const PATH_PATTERN = /^\/mcp\/(project|goal)\/([\w-]+)$/;

export class BridgeMcpServer {
  private readonly token = randomBytes(32).toString('hex');
  private readonly tools: BridgeTools;
  private readonly handleMcp = toNodeHandler(
    createMcpHandler((ctx) => this.createServer(ctx.authInfo)),
  );
  private readonly validateHost = localhostHostValidation();
  private readonly validateOrigin = localhostOriginValidation();
  private server: Server | null = null;
  private listening: Promise<number> | null = null;

  constructor(
    private readonly store: BridgeStore,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    this.tools = new BridgeTools(store);
  }

  /** localhost の空いているポートで待ち受けを始める */
  start(): Promise<number> {
    this.listening ??= new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((error: unknown) => {
          this.onError(error);
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        });
      });
      this.server = server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve((server.address() as AddressInfo).port);
      });
    });
    return this.listening;
  }

  /**
   * セッションに渡す接続先。待ち受けに失敗していたら null（ツールなしで実行する）。
   */
  async configFor(scope: SessionScope): Promise<McpServerConfig | null> {
    try {
      const port = await this.start();
      return {
        name: BRIDGE_MCP_SERVER_NAME,
        url: `http://127.0.0.1:${port}/mcp/${scope.type}/${scope.id}`,
        headers: { Authorization: `Bearer ${this.token}` },
      };
    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    // ブラウザのページからの DNS リバインディングなどを防ぐ
    if (!this.validateHost(req, res) || !this.validateOrigin(req, res)) {
      return;
    }
    if (!this.isAuthorized(req.headers.authorization)) {
      res.writeHead(401).end();
      return;
    }
    const scope = this.resolveScope(new URL(req.url ?? '/', 'http://x'));
    if (!scope) {
      res.writeHead(404).end();
      return;
    }
    // 範囲は認証の情報として MCP サーバーを作る関数に渡す
    const auth: AuthInfo = {
      token: this.token,
      clientId: BRIDGE_MCP_SERVER_NAME,
      scopes: [],
      extra: { scope },
    };
    await this.handleMcp(Object.assign(req, { auth }), res);
  }

  private isAuthorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const actual = Buffer.from(header ?? '');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  /** URL のパスから、ツールの範囲を求める。目標や対象modが消えていたら null */
  private resolveScope(url: URL): ToolScope | null {
    const match = PATH_PATTERN.exec(url.pathname);
    if (!match) {
      return null;
    }
    const [, type, id] = match;
    if (type === 'goal') {
      const goal = this.store.goals.find(id);
      return goal ? { projectId: goal.projectId, goalId: goal.id } : null;
    }
    return this.store.projects.find(id)
      ? { projectId: id, goalId: null }
      : null;
  }

  private createServer(auth: AuthInfo | undefined): McpServer {
    const scope = auth?.extra?.scope as ToolScope;
    const server = new McpServer({
      name: BRIDGE_MCP_SERVER_NAME,
      version: '1.0.0',
    });
    const annotations = { readOnlyHint: true, openWorldHint: false };
    const goalId = z
      .string()
      .optional()
      .describe(
        '目標の goalId（list_goals で分かる）。省くと、このセッションの目標',
      );

    server.registerTool(
      'list_goals',
      {
        description:
          '対象modの目標の一覧（題名・状態・タスクの進み具合・goalId）を返します。',
        annotations,
      },
      () => run(() => this.tools.listGoals(scope)),
    );
    server.registerTool(
      'get_goal',
      {
        description:
          '目標の依頼文・計画の方針・タスクの一覧（番号・題名・種類・依存・状態）を返します。',
        inputSchema: z.object({ goalId }),
        annotations,
      },
      (args) => run(() => this.tools.getGoal(scope, args.goalId)),
    );
    server.registerTool(
      'get_task',
      {
        description:
          '目標のタスクの内容・状態と、終わったタスクの結果の報告を返します。ほかのタスクが何をしたか知りたいときに使います。',
        inputSchema: z.object({
          number: z.number().int().describe('タスクの番号（#1 なら 1）'),
          goalId,
        }),
        annotations,
      },
      (args) => run(() => this.tools.getTask(scope, args.number, args.goalId)),
    );
    return server;
  }
}

/** ツールの結果を MCP の形にする。ToolError はエラーの結果として AI に返す */
function run(fn: () => string): CallToolResult {
  try {
    return { content: [{ type: 'text', text: fn() }] };
  } catch (error) {
    if (error instanceof ToolError) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
    throw error;
  }
}
