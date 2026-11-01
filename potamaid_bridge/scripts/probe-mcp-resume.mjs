// 外部 AI は呼ばない。隔離した CODEX_HOME・localhost の偽モデルと MCP で設定更新を確認する。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const home = await mkdtemp(path.join(tmpdir(), 'potamaid-codex-probe-'));
await writeFile(path.join(home, 'config.toml'), 'model = "gpt-6.1-sol"\n');
let calls = [];
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/v1/')) {
    for await (const _chunk of req) {
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(
      'event: response.completed\ndata: ' +
        JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'probe',
            object: 'response',
            status: 'completed',
            output: [],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        }) +
        '\n\n',
    );
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  const m = JSON.parse(body);
  calls.push([req.url, m.method, m.params?.protocolVersion]);
  if (!('id' in m)) {
    res.writeHead(202).end();
    return;
  }
  let result = {};
  if (m.method === 'initialize')
    result = {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'probe', version: '1' },
    };
  if (m.method === 'tools/list')
    result = {
      tools: [
        {
          name: req.url === '/a' ? 'tool_a' : 'tool_b',
          description: 'probe',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  res
    .writeHead(200, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await writeFile(
  path.join(home, 'config.toml'),
  `model = "gpt-6.1-sol"\n[model_providers.mock]\nname = "mock"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
);
const binary = process.argv[2];
let child;
function launch() {
  child = spawn(binary, ['app-server'], {
    env: { ...process.env, CODEX_HOME: home },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const m = JSON.parse(line);
      if ('id' in m) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p?.reject(new Error(JSON.stringify(m.error)));
        else p?.resolve(m.result);
      } else notices.push(m);
    } catch {}
  });
  child.stderr.resume();
}
let seq = 0;
const pending = new Map();
const notices = [];
launch();
const timer = setTimeout(() => {
  child.kill();
  server.close();
  console.error('probe timeout');
  process.exitCode = 1;
}, 45000);
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await request('initialize', {
    clientInfo: { name: 'potamaid_probe', version: '1' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write('{"method":"initialized"}\n');
  const config = (url) => ({
    'mcp_servers.potamaid_game': {
      url: `http://127.0.0.1:${server.address().port}${url}`,
    },
  });
  const start = await request('thread/start', {
    cwd: process.cwd(),
    model: 'gpt-6.1-sol',
    modelProvider: 'mock',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: {
      ...config('/a'),
      'model_providers.mock': {
        name: 'mock',
        base_url: `http://127.0.0.1:${server.address().port}/v1`,
        wire_api: 'responses',
        requires_openai_auth: false,
      },
    },
  });
  const threadId = start.thread.id;
  const turn = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'local protocol probe', text_elements: [] }],
  });
  await new Promise((r) => setTimeout(r, 1000));
  await request('turn/interrupt', { threadId, turnId: turn.turn.id }).catch(
    () => undefined,
  );
  await new Promise((r) => setTimeout(r, 1500));
  const statusA = await request('mcpServerStatus/list', { threadId });
  await request('thread/resume', {
    threadId,
    excludeTurns: true,
    config: config('/b'),
  });
  await new Promise((r) => setTimeout(r, 1500));
  const statusB = await request('mcpServerStatus/list', { threadId });
  child.kill();
  await onceExit(child);
  launch();
  await request('initialize', {
    clientInfo: { name: 'potamaid_probe', version: '1' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write('{"method":"initialized"}\n');
  await request('thread/resume', {
    threadId,
    excludeTurns: true,
    config: config('/b'),
  });
  await new Promise((r) => setTimeout(r, 1000));
  const statusFresh = await request('mcpServerStatus/list', { threadId });
  assert.ok(statusA.data[0].tools.tool_a, 'initial tool');
  assert.ok(
    statusB.data[0].tools.tool_a,
    'loaded resume retains old tool on tested CLI',
  );
  assert.ok(statusFresh.data[0].tools.tool_b, 'isolated resume updates tool');
  console.log(
    JSON.stringify(
      {
        calls,
        statusA,
        statusB,
        statusFresh,
        warnings: notices.filter((n) => n.method?.includes('warning')),
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timer);
  child.kill();
  server.closeAllConnections();
  server.close();
}

function onceExit(process) {
  return process.exitCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => process.once('exit', resolve));
}
