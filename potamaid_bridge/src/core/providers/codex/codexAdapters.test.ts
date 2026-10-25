/**
 * Codex のプロトコルと Bridge の形の変換（コマンドの表示・質問・MCP の入力フォーム・起動のしかた）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpServersConfig } from './CodexProvider';
import { describeCommand, unwrapShell } from './mapping';
import { resolveLaunchCommand } from './resolveExecutable';
import {
  schemaToFields,
  toElicitationRequest,
  toElicitationResponse,
  toQuestionRequest,
  toQuestionResponse,
} from './userInput';

describe('コマンドの表示', () => {
  it('解析済みの操作があれば、それを並べる', () => {
    expect(
      describeCommand('powershell.exe -Command "Get-Content a.txt"', [
        {
          type: 'read',
          command: 'Get-Content a.txt',
          name: 'a.txt',
          path: 'a.txt',
        },
        { type: 'search', command: 'rg foo', query: 'foo', path: 'src' },
      ]),
    ).toBe('読み取り: a.txt、検索: foo（src）');
  });

  it('分からない操作があれば、シェルの包みを外したコマンドを出す', () => {
    const command =
      '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content -Encoding UTF8 ..\\\\docs\\\\a.md"';
    expect(describeCommand(command, [{ type: 'unknown', command: 'x' }])).toBe(
      'Get-Content -Encoding UTF8 ..\\docs\\a.md',
    );
  });

  it('bash -lc の包みも外す', () => {
    expect(unwrapShell("/bin/bash -lc 'ls -la'")).toBe('ls -la');
    expect(unwrapShell('git status')).toBe('git status');
  });
});

describe('AI からの質問', () => {
  const params = {
    threadId: 't',
    turnId: 'u',
    itemId: 'i',
    isBlocking: true,
    autoResolutionMs: null,
    questions: [
      {
        id: 'q1',
        header: 'モデル',
        question: 'どちらにしますか？',
        isOther: false,
        isSecret: false,
        options: [{ label: 'A', description: '' }],
      },
      {
        id: 'q2',
        header: '',
        question: '名前は？',
        isOther: false,
        isSecret: true,
        options: null,
      },
    ],
  };

  it('選択肢のない質問は自由に回答できるようにする', () => {
    const request = toQuestionRequest(params);
    expect(request.kind).toBe('question');
    expect(request.questions.map((q) => q.allowOther)).toEqual([false, true]);
    expect(request.questions[1]?.secret).toBe(true);
  });

  it('回答を Codex の形にする。回答しなければ空にする', () => {
    expect(
      toQuestionResponse({ decision: 'allow', answers: { q1: ['A'] } }),
    ).toEqual({ answers: { q1: { answers: ['A'] } } });
    expect(toQuestionResponse({ decision: 'deny' })).toEqual({ answers: {} });
  });
});

describe('MCP の入力要求', () => {
  it('フォームの schema を入力項目にする', () => {
    const fields = schemaToFields({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', title: '名前' },
        count: { type: 'integer', default: 3 },
        ok: { type: 'boolean' },
        color: { type: 'string', enum: ['r', 'g'], enumNames: ['赤', '緑'] },
        size: { type: 'string', oneOf: [{ const: 's', title: '小' }] },
        tags: { type: 'array', items: { anyOf: [{ const: 'a', title: 'A' }] } },
      },
    });
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ['name', 'text', true],
      ['count', 'integer', false],
      ['ok', 'boolean', false],
      ['color', 'select', false],
      ['size', 'select', false],
      ['tags', 'multiSelect', false],
    ]);
    expect(fields[1]?.defaultValue).toBe(3);
    expect(fields[3]?.options).toEqual([
      { value: 'r', label: '赤' },
      { value: 'g', label: '緑' },
    ]);
  });

  it('URL を開く要求と、回答の形', () => {
    const request = toElicitationRequest({
      threadId: 't',
      turnId: null,
      serverName: 'potamaid',
      mode: 'url',
      _meta: null,
      message: 'ログインしてください',
      url: 'https://example.com',
      elicitationId: 'e',
    });
    expect(request).toMatchObject({
      kind: 'url',
      url: 'https://example.com',
      source: 'potamaid',
    });
    expect(toElicitationResponse({ decision: 'deny' }).action).toBe('decline');
    expect(
      toElicitationResponse({ decision: 'allow', values: { name: 'x' } }),
    ).toEqual({ action: 'accept', content: { name: 'x' }, _meta: null });
  });
});

describe('セッションの MCP サーバー', () => {
  it('ドット区切りのキーで、利用者の設定に追加する', () => {
    expect(
      mcpServersConfig([
        {
          name: 'potamaid_bridge',
          url: 'http://127.0.0.1:1234/mcp/goal/g',
          headers: { Authorization: 'Bearer x' },
        },
      ]),
    ).toEqual({
      'mcp_servers.potamaid_bridge': {
        url: 'http://127.0.0.1:1234/mcp/goal/g',
        http_headers: { Authorization: 'Bearer x' },
      },
    });
    expect(mcpServersConfig([])).toBeNull();
  });
});

describe('Codex の起動のしかた', () => {
  it('Windows の .cmd は cmd.exe を通して起動する', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codex-cmd-'));
    try {
      const shim = path.join(dir, 'codex.cmd');
      writeFileSync(shim, '');
      const command = resolveLaunchCommand(
        '',
        ['app-server'],
        { ComSpec: 'cmd.exe', PATH: dir, PATHEXT: '.CMD' },
        'win32',
      );
      expect(command.file).toBe('cmd.exe');
      expect(command.args.at(-1)).toBe(`"${shim} app-server"`);
      expect(command.windowsVerbatimArguments).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('実行ファイルは直接起動する', () => {
    const command = resolveLaunchCommand(
      process.execPath,
      ['app-server'],
      {},
      'linux',
    );
    expect(command.file).toBe(process.execPath);
    expect(command.args).toEqual(['app-server']);
  });
});
