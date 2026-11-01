// serveTestBridgeClient と組み合わせ、Mod の実際の Java WebSocket クライアントを検証する。
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const directory = path.resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
await rm(path.join(directory, 'stop'), { force: true });
let phase = 0;
let gameId;
let finish;
let fail;
const completed = new Promise((resolve, reject) => {
  finish = resolve;
  fail = reject;
});
let server;
async function start() {
  const token = randomBytes(32).toString('hex');
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server = wss;
  await new Promise((resolve) => wss.once('listening', resolve));
  wss.on('connection', (ws, req) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      assert.equal(req.headers.origin, undefined);
    } catch {
      fail(new Error('WebSocket authentication check failed'));
      return;
    }
    ws.on('message', async (bytes) => {
      try {
        const m = JSON.parse(bytes.toString());
        if (m.type === 'hello') {
          assert.equal(m.protocolVersion, 1);
          assert.equal(m.projectRoot, '');
          assert.equal(
            path.resolve(m.gameDirectory).toLowerCase(),
            directory.toLowerCase(),
          );
          if (gameId) assert.equal(m.gameInstanceId, gameId);
          else gameId = m.gameInstanceId;
          ws.send(
            JSON.stringify({
              type: 'welcome',
              protocolVersion: 1,
              projectId: 'test',
            }),
          );
          ws.ping();
        } else if (m.type === 'ping') ws.send('{"type":"pong"}');
        else if (m.type === 'game_state') {
          assert.equal(m.gameInstanceId, gameId);
          if (phase === 0) {
            assert.equal(m.worldAvailable, false);
            phase = 1;
            await writeFile(
              path.join(directory, 'state.json'),
              JSON.stringify({
                worldAvailable: true,
                mcpAvailable: true,
                mcp: {
                  url: 'http://127.0.0.1:38281/mcp',
                  headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
                },
              }),
            );
          } else if (phase === 1) {
            assert.equal(m.mcpAvailable, true);
            phase = 2;
            await writeFile(
              path.join(directory, 'state.json'),
              JSON.stringify({ worldAvailable: false, mcpAvailable: false }),
            );
          } else if (phase === 2) {
            assert.equal(m.mcpAvailable, false);
            phase = 3;
            ws.terminate();
            await new Promise((resolve) => wss.close(resolve));
            await start();
          } else if (phase === 3) {
            assert.equal(m.mcpAvailable, false);
            phase = 4;
            finish();
          }
        }
      } catch {
        fail(new Error('Mod WebSocket state/reconnect check failed'));
      }
    });
  });
  const temporary = path.join(directory, '.bridge.tmp');
  await writeFile(
    temporary,
    JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      instanceId: randomUUID(),
      url: `ws://127.0.0.1:${wss.address().port}/mod`,
      token,
    }),
  );
  await rename(temporary, path.join(directory, 'bridge.json'));
}
await start();
console.log('WebSocket fixture ready');
const timer = setTimeout(
  () => fail(new Error('Mod WebSocket check timeout')),
  45000,
);
try {
  await completed;
  console.log(
    'Java Mod client: hello, world open/close, and reconnect after Bridge endpoint/token change passed',
  );
} finally {
  clearTimeout(timer);
  await writeFile(path.join(directory, 'stop'), 'stop');
  for (const ws of server.clients) ws.terminate();
  server.close();
}
