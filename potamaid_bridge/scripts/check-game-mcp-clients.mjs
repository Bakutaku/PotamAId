// 起動済みの serveTestGameMcp に、実際の CLI の MCP クライアントだけで接続する。外部 AI は呼ばない。
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const [binary, gameConfigPath, claude = 'claude'] = process.argv.slice(2);
const config = JSON.parse(await readFile(gameConfigPath, 'utf8'));
const home = await mkdtemp(path.join(tmpdir(), 'potamaid-client-check-'));
await writeFile(path.join(home, 'config.toml'), 'model = "gpt-6.1-sol"\n');
const child = spawn(binary, ['app-server'], {
  env: { ...process.env, CODEX_HOME: home },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stderr.resume();
let id = 0;
const waiting = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
  try {
    const m = JSON.parse(line);
    const pending = waiting.get(m.id);
    if (pending) {
      waiting.delete(m.id);
      if (m.error) pending.reject(new Error('Codex protocol request failed'));
      else pending.resolve(m.result);
    }
  } catch {}
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const seq = ++id;
    waiting.set(seq, { resolve, reject });
    child.stdin.write(JSON.stringify({ id: seq, method, params }) + '\n');
  });
}
const timer = setTimeout(() => {
  child.kill();
  console.error('client check timeout');
  process.exitCode = 1;
}, 30000);
try {
  await request('initialize', {
    clientInfo: { name: 'potamaid_mcp_check', version: '1' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write('{"method":"initialized"}\n');
  const result = await request('thread/start', {
    cwd: process.cwd(),
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: {
      'mcp_servers.potamaid_game': {
        url: config.url,
        http_headers: config.headers,
      },
    },
  });
  const threadId = result.thread.id;
  const inventory = await request('mcpServerStatus/list', {
    threadId,
    serverName: 'potamaid_game',
  });
  assert.ok(
    inventory.data[0].tools.get_player_snapshot,
    'Codex must discover the real Java tool',
  );
  const toolResult = await request('mcpServer/tool/call', {
    threadId,
    server: 'potamaid_game',
    tool: 'get_player_snapshot',
    arguments: {},
  });
  assert.ok(
    JSON.stringify(toolResult).includes('TestPlayer'),
    'Codex must call the Java tool',
  );
  console.log('Codex: Java MCP tool discovery and snapshot call passed');
  const claudeDir = path.join(home, 'claude');
  await mkdir(claudeDir);
  const claudeEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeDir,
    POTAMAID_GAME_MCP_AUTH: config.headers.Authorization,
  };
  // mcp list は --mcp-config の一時設定を使わないため、隔離ディレクトリのユーザー設定へ登録する。
  await promisify(execFile)(
    claude,
    [
      'mcp',
      'add-json',
      '--scope',
      'user',
      'potamaid_game',
      JSON.stringify({
        type: 'http',
        url: config.url,
        headers: { Authorization: '${POTAMAID_GAME_MCP_AUTH}' },
      }),
    ],
    { env: claudeEnv, windowsHide: true, timeout: 10000 },
  );
  const health = await promisify(execFile)(claude, ['mcp', 'list'], {
    env: claudeEnv,
    windowsHide: true,
    timeout: 20000,
  });
  // 出力には設定が含まれ得るため、そのまま転記しない。
  if (!/potamaid_game.*(?:Connected|接続済み)/i.test(health.stdout))
    console.log(
      health.stdout
        .replaceAll(config.headers.Authorization, '[redacted]')
        .replace(/[a-f0-9]{64}/g, '[redacted]'),
    );
  assert.ok(
    /potamaid_game.*(?:Connected|接続済み)/i.test(health.stdout),
    'Claude Code health check must connect',
  );
  console.log(
    'Claude Code: Java MCP health check passed (AI tool invocation remains unverified)',
  );
} finally {
  clearTimeout(timer);
  child.kill();
}
