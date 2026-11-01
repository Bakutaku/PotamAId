import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Project } from '../../shared/domain';
import { ModConnectionServer, validMcpUrl } from './ModConnectionServer';
import { normalizeProjectRoot } from './privateFiles';

describe('Mod と Bridge の接続', () => {
  let directory: string;
  let project: Project;
  let projects: Project[];
  let server: ModConnectionServer;
  let info: { url: string; token: string; instanceId: string };
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'potamaid-mod-'));
    project = {
      id: 'project',
      name: 'test',
      rootPath: directory,
      readOnlyConcurrency: 2,
      editConcurrency: 1,
      weightProfiles: {},
      createdAt: 1,
    };
    projects = [project];
    server = new ModConnectionServer(
      () => projects,
      () => undefined,
      path.join(directory, 'private'),
    );
    await server.start();
    info = JSON.parse(
      await readFile(path.join(directory, 'private', 'bridge.json'), 'utf8'),
    );
  });
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function open(headers: Record<string, string> = {}) {
    const ws = new WebSocket(info.url, {
      headers: { Authorization: `Bearer ${info.token}`, ...headers },
    });
    sockets.push(ws);
    await once(ws, 'open');
    return ws;
  }
  async function send(ws: WebSocket, data: unknown) {
    const response = once(ws, 'message');
    ws.send(JSON.stringify(data));
    return JSON.parse((await response)[0].toString());
  }
  function hello(gameInstanceId = randomUUID(), root = directory) {
    return {
      type: 'hello',
      protocolVersion: 1,
      gameInstanceId,
      projectRoot: root,
    };
  }
  async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('状態が更新されません');
  }
  it('認証・Origin・Host を検証する', async () => {
    await expect(open({ Authorization: 'Bearer invalid' })).rejects.toThrow();
    await expect(open({ Origin: 'http://localhost' })).rejects.toThrow();
    await expect(open({ Host: 'evil.example' })).rejects.toThrow();
    expect((await send(await open(), hello())).type).toBe('welcome');
  });
  it('projectRoot が空なら gameDirectory を使って接続する', async () => {
    const gameDirectory = path.join(directory, 'mod', 'run');
    await mkdir(gameDirectory, { recursive: true });
    const ws = await open();
    expect(
      (await send(ws, { ...hello(), projectRoot: '', gameDirectory }))
        .projectId,
    ).toBe('project');
    expect(server.snapshot().project.state).toBe('connected');
  });
  it('自動設定できない理由を Bridge に表示し、登録変更後の再試行で解消する', async () => {
    const gameDirectory = path.join(directory, 'mod', 'run');
    await mkdir(gameDirectory, { recursive: true });
    projects.push({
      ...project,
      id: 'mod',
      rootPath: path.dirname(gameDirectory),
    });
    const message = { ...hello(), projectRoot: '', gameDirectory };
    expect((await send(await open(), message)).code).toBe('ambiguous_project');
    expect(server.snapshot().project).toMatchObject({
      state: 'error',
      message: expect.stringContaining('複数'),
    });
    projects = [project];
    expect((await send(await open(), message)).type).toBe('welcome');
    expect(server.snapshot().project.state).toBe('connected');
  });
  it('対象フォルダーの完全一致とバージョンを確認し、2つ目のゲームで置き換えない', async () => {
    expect(
      (await send(await open(), { ...hello(), protocolVersion: 2 })).code,
    ).toBe('protocol_mismatch');
    await mkdir(path.join(directory, 'child'));
    expect(
      (
        await send(
          await open(),
          hello(randomUUID(), path.join(directory, 'child')),
        )
      ).code,
    ).toBe('unknown_project');
    const ws = await open();
    expect((await send(ws, hello())).projectId).toBe('project');
    expect((await send(await open(), hello())).code).toBe(
      'game_already_connected',
    );
    expect(server.snapshot().project.state).toBe('connected');
    expect((await send(ws, { type: 'ping' })).type).toBe('pong');
  });
  it('ワールドの利用可否・失敗・切断を反映し、UI に秘密を渡さない', async () => {
    const ws = await open();
    const message = hello();
    await send(ws, message);
    const token = 'a'.repeat(64);
    const state = {
      type: 'game_state',
      gameInstanceId: message.gameInstanceId,
      worldAvailable: true,
      mcpAvailable: true,
      mcp: {
        url: 'http://127.0.0.1:38281/mcp',
        headers: { Authorization: `Bearer ${token}` },
      },
    };
    ws.send(JSON.stringify(state));
    await waitFor(() => server.snapshot().project.state === 'available');
    expect(server.configFor('project')?.name).toBe('potamaid_game');
    expect(JSON.stringify(server.snapshot()).includes(token)).toBe(false);
    ws.send(
      JSON.stringify({
        ...state,
        mcpAvailable: false,
        mcp: undefined,
        error: `untrusted ${token}`,
      }),
    );
    await waitFor(() => server.snapshot().project.state === 'error');
    expect(server.configFor('project')).toBeNull();
    expect(JSON.stringify(server.snapshot()).includes(token)).toBe(false);
    ws.send(
      JSON.stringify({
        ...state,
        worldAvailable: false,
        mcpAvailable: false,
        mcp: undefined,
      }),
    );
    await waitFor(() => server.snapshot().project.state === 'connected');
    ws.close();
    await once(ws, 'close');
    await waitFor(() => server.snapshot().project.state === 'disconnected');
  });
  it('ゲーム ID の不一致と外部 MCP URL を拒否する', async () => {
    const ws = await open();
    await send(ws, hello());
    const bad = {
      type: 'game_state',
      gameInstanceId: randomUUID(),
      worldAvailable: true,
      mcpAvailable: false,
    };
    expect((await send(ws, bad)).code).toBe('invalid_state');
    for (const url of [
      'https://127.0.0.1:38281/mcp',
      'http://localhost:38281/mcp',
      'http://127.0.0.1:38281/mcp?token=x',
      'http://127.0.0.1:38281/other',
      'http://user:secret@127.0.0.1:38281/mcp',
      'http://127.1:38281/mcp',
    ])
      expect(validMcpUrl(url)).toBe(false);
  });
  it('終了時は自分の発見ファイルだけを削除する', async () => {
    const file = path.join(directory, 'private', 'bridge.json');
    await writeFile(file, JSON.stringify({ instanceId: 'another-instance' }));
    await server.close();
    expect(JSON.parse(await readFile(file, 'utf8')).instanceId).toBe(
      'another-instance',
    );
  });
  it('フォルダーの末尾と Windows の大文字・小文字を正規化する', async () => {
    expect(await normalizeProjectRoot(directory + path.sep)).toBe(
      await normalizeProjectRoot(directory),
    );
    if (process.platform === 'win32')
      expect(await normalizeProjectRoot(directory.toUpperCase())).toBe(
        await normalizeProjectRoot(directory),
      );
  });
});
