// 実際の Java クライアントの操作応答・通知・切断を検証する。Minecraft・AI は起動しない。
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const directory = path.resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
for (const file of ['stop', 'response.json', 'events.jsonl', 'command.json'])
  await rm(path.join(directory, file), { force: true });
const token = randomBytes(32).toString('hex');
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise((resolve) => server.once('listening', resolve));
let phase = 0;
let creates = 0;
let failure;
server.on('connection', (ws, req) => {
  try {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
  } catch {
    failure = new Error('authentication failed');
  }
  ws.on('message', async (bytes) => {
    try {
      const m = JSON.parse(bytes.toString());
      if (m.type === 'hello') {
        assert.equal(m.protocolVersion, 2);
        ws.send(
          JSON.stringify({
            type: 'welcome',
            protocolVersion: 2,
            projectId: 'test',
          }),
        );
      } else if (m.type === 'ping') ws.send('{"type":"pong"}');
      else if (m.type === 'game_state' && phase === 0) {
        phase = 1;
        await writeFile(
          path.join(directory, 'command.json'),
          '{"action":"status"}',
        );
      } else if (m.type === 'request') {
        assert.equal(typeof m.requestId, 'string');
        if (m.operation.action === 'status') {
          ws.send(
            JSON.stringify({
              type: 'response',
              requestId: m.requestId,
              ok: true,
              data: { kind: 'status', name: 'test' },
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'notice',
              title: '承認待ち',
              body: 'Bridge で確認',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'approval_resolved',
              id: 'approval-test',
              by: 'app',
              decision: 'deny',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'consult_state',
              consult: { id: 'test', status: 'idle' },
              answer: '回答',
            }),
          );
        } else if (m.operation.action === 'consult_new') {
          creates++;
          phase = 2;
          ws.terminate(); // 実行を受け付けた後、結果が届く前に切断する。
        }
      } else if (m.type === 'game_state' && phase === 2) phase = 3;
    } catch {
      failure = new Error('control protocol check failed');
    }
  });
});
const temp = path.join(directory, '.bridge.tmp');
await writeFile(
  temp,
  JSON.stringify({
    schemaVersion: 1,
    protocolVersion: 2,
    instanceId: randomUUID(),
    url: `ws://127.0.0.1:${server.address().port}/mod`,
    token,
  }),
);
await rename(temp, path.join(directory, 'bridge.json'));
console.log('Control fixture ready');
async function waitFor(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    try {
      if (await predicate()) return;
    } catch (e) {
      if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('control fixture timeout');
}
try {
  await waitFor(
    async () =>
      JSON.parse(await readFile(path.join(directory, 'response.json'), 'utf8'))
        .ok === true,
  );
  await waitFor(async () => {
    const events = (
      await readFile(path.join(directory, 'events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    return (
      events.some((e) => e.type === 'notice') &&
      events.some((e) => e.type === 'approval_resolved' && e.by === 'app') &&
      events.some((e) => e.type === 'consult_state' && e.answer === '回答')
    );
  });
  await rm(path.join(directory, 'response.json'));
  await writeFile(
    path.join(directory, 'command.json'),
    '{"action":"consult_new","text":"test"}',
  );
  await waitFor(
    async () =>
      phase === 3 &&
      JSON.parse(await readFile(path.join(directory, 'response.json'), 'utf8'))
        .ok === false,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(creates, 1, 'unconfirmed operation must not be resent');
  console.log(
    'Java control response, notifications, approval sync, unknown result and reconnect passed',
  );
} finally {
  await writeFile(path.join(directory, 'stop'), 'stop');
  for (const ws of server.clients) ws.terminate();
  await new Promise((resolve) => server.close(resolve));
}
