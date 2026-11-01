import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Goal, Task } from '../../shared/domain';
import type { McpServerConfig } from '../providers/AiProvider';
import { BridgeStore } from '../store/BridgeStore';
import { BridgeMcpServer } from './BridgeMcpServer';
import { BridgeTools, ToolError } from './bridgeTools';

function goal(id: string, projectId: string, patch: Partial<Goal> = {}): Goal {
  return {
    id,
    projectId,
    title: `目標 ${id}`,
    text: `${id} を作りたい`,
    status: 'active',
    planSummary: null,
    planError: null,
    providerId: 'codex',
    profileId: null,
    model: null,
    effort: null,
    branch: null,
    baseBranch: null,
    worktreePath: null,
    workDir: null,
    waitReason: null,
    roundStartedAt: null,
    createdAt: 0,
    ...patch,
  };
}

function task(
  id: string,
  goalId: string,
  number: number,
  patch: Partial<Task> = {},
) {
  return {
    id,
    goalId,
    number,
    title: `タスク ${number}`,
    description: `${number} の内容`,
    kind: 'edit' as const,
    weight: 'standard' as const,
    profileId: null,
    runInfo: null,
    status: 'todo' as const,
    paused: false,
    latest: null,
    result: null,
    needsGameRestart: false,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...patch,
  };
}

let store: BridgeStore;

beforeEach(() => {
  store = new BridgeStore(':memory:');
  for (const id of ['p1', 'p2']) {
    store.projects.insert({
      id,
      name: id,
      rootPath: `/${id}`,
      readOnlyConcurrency: 2,
      editConcurrency: 1,
      weightProfiles: {},
      createdAt: 0,
    });
  }
  store.goals.insert(goal('g1', 'p1', { planSummary: '方針' }));
  store.goals.insert(goal('g2', 'p1', { status: 'done' }));
  store.goals.insert(goal('other', 'p2'));
  store.tasks.insert(
    task('t1', 'g1', 1, {
      kind: 'investigate',
      status: 'done',
      result: '機械は Machine.java',
    }),
    [],
  );
  store.tasks.insert(task('t2', 'g1', 2, { status: 'running' }), ['t1']);
});

afterEach(() => store.close());

describe('BridgeTools', () => {
  const inGoal = { projectId: 'p1', goalId: 'g1' };
  const inProject = { projectId: 'p1', goalId: null };

  it('対象modの目標だけを一覧にする', () => {
    const text = new BridgeTools(store).listGoals(inGoal);
    expect(text).toContain(
      '目標 g1（進行中・タスク 1/2・このセッションの目標）',
    );
    expect(text).toContain('目標 g2（完了・タスク 0/0）');
    expect(text).not.toContain('other');
  });

  it('goalId を省くと、セッションの目標を返す', () => {
    const text = new BridgeTools(store).getGoal(inGoal, undefined);
    expect(text).toContain('# 目標 g1（進行中）');
    expect(text).toContain('方針');
    expect(text).toContain('- #2 タスク 2（編集・#1 の後・実行中）');
  });

  it('タスクの内容と結果を返す', () => {
    const text = new BridgeTools(store).getTask(inGoal, 1, undefined);
    expect(text).toContain('# #1 タスク 1（調査・完了）');
    expect(text).toContain('## 結果\n機械は Machine.java');
  });

  it('相談では goalId が必要で、ほかの対象modの目標は返さない', () => {
    const tools = new BridgeTools(store);
    expect(() => tools.getGoal(inProject, undefined)).toThrow(ToolError);
    expect(() => tools.getGoal(inProject, 'other')).toThrow('見つかりません');
    expect(tools.getTask(inProject, 2, 'g1')).toContain('# #2 タスク 2');
  });

  it('ないタスクの番号はエラーにする', () => {
    expect(() => new BridgeTools(store).getTask(inGoal, 5, undefined)).toThrow(
      '#1〜#2',
    );
  });
});

describe('BridgeMcpServer', () => {
  let server: BridgeMcpServer;

  beforeEach(() => {
    server = new BridgeMcpServer(store);
  });

  afterEach(() => server.close());

  /** JSON-RPC の要求を1つ送り、結果を返す（SSE で返ってきたら data を読む） */
  async function call(
    config: McpServerConfig,
    method: string,
    params: unknown,
    headers = config.headers,
  ) {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) {
      return { status: response.status, body: null };
    }
    const text = await response.text();
    const data = response.headers.get('content-type')?.includes('event-stream')
      ? (/^data: (.*)$/m.exec(text)?.[1] ?? 'null')
      : text;
    return { status: response.status, body: JSON.parse(data) };
  }

  const initialize = {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  };

  it('トークンがない要求は断る', async () => {
    const config = await server.configFor({ type: 'goal', id: 'g1' });
    expect(config).not.toBeNull();
    const { status } = await call(config!, 'initialize', initialize, {});
    expect(status).toBe(401);
  });

  it('消えた目標の範囲は 404 にする', async () => {
    const config = await server.configFor({ type: 'goal', id: 'missing' });
    const { status } = await call(config!, 'initialize', initialize);
    expect(status).toBe(404);
  });

  it('ツールの一覧と呼び出しに答える', async () => {
    const config = await server.configFor({ type: 'goal', id: 'g1' });
    expect((await call(config!, 'initialize', initialize)).status).toBe(200);

    const list = await call(config!, 'tools/list', {});
    expect(
      list.body.result.tools.map((t: { name: string }) => t.name).sort(),
    ).toEqual(['get_goal', 'get_task', 'list_goals']);

    const result = await call(config!, 'tools/call', {
      name: 'get_task',
      arguments: { number: 1 },
    });
    expect(result.body.result.content[0].text).toContain('機械は Machine.java');

    const error = await call(config!, 'tools/call', {
      name: 'get_task',
      arguments: { number: 9 },
    });
    expect(error.body.result.isError).toBe(true);
  });
});
