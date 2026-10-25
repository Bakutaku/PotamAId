import { describe, expect, it, vi } from 'vitest';
import { JsonRpcConnection, JsonRpcError } from './JsonRpcConnection';

/** 送った行を記録する接続を作る */
function setup(
  onRequest: (method: string, params: unknown) => Promise<unknown> = () =>
    Promise.resolve(null),
) {
  const sent: unknown[] = [];
  const onNotification = vi.fn();
  const onProtocolError = vi.fn();
  const connection = new JsonRpcConnection(
    (line) => sent.push(JSON.parse(line)),
    { onNotification, onRequest, onProtocolError },
  );
  return { connection, sent, onNotification, onProtocolError };
}

describe('JsonRpcConnection', () => {
  it('要求に ID を付けて送り、同じ ID の応答で解決する', async () => {
    const { connection, sent } = setup();
    const pending = connection.request('thread/start', { cwd: '/mod' });
    expect(sent).toEqual([
      { id: 1, method: 'thread/start', params: { cwd: '/mod' } },
    ]);
    connection.handleLine(JSON.stringify({ id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('エラーの応答で失敗する', async () => {
    const { connection } = setup();
    const pending = connection.request('turn/start', {});
    connection.handleLine(
      JSON.stringify({ id: 1, error: { code: -32000, message: 'だめ' } }),
    );
    await expect(pending).rejects.toBeInstanceOf(JsonRpcError);
  });

  it('通知を受け取る', () => {
    const { connection, onNotification } = setup();
    connection.handleLine(
      JSON.stringify({ method: 'turn/started', params: { threadId: 't' } }),
    );
    expect(onNotification).toHaveBeenCalledWith('turn/started', {
      threadId: 't',
    });
  });

  it('相手からの要求に応答を返す', async () => {
    const { connection, sent } = setup(async () => ({ decision: 'accept' }));
    connection.handleLine(
      JSON.stringify({
        id: 'r1',
        method: 'item/fileChange/requestApproval',
        params: {},
      }),
    );
    await vi.waitFor(() =>
      expect(sent).toEqual([{ id: 'r1', result: { decision: 'accept' } }]),
    );
  });

  it('相手からの要求の処理が失敗したら、エラーを返す', async () => {
    const { connection, sent } = setup(async () => {
      throw new Error('対応していません');
    });
    connection.handleLine(
      JSON.stringify({ id: 2, method: 'unknown', params: {} }),
    );
    await vi.waitFor(() =>
      expect(sent).toEqual([
        { id: 2, error: { code: -32601, message: '対応していません' } },
      ]),
    );
  });

  it('読めない行は知らせて読み飛ばす', () => {
    const { connection, onProtocolError } = setup();
    connection.handleLine('not json');
    connection.handleLine('');
    expect(onProtocolError).toHaveBeenCalledTimes(1);
  });

  it('決めた時間に応答がなければ失敗させ、遅れて届いた応答は無視する', async () => {
    vi.useFakeTimers();
    try {
      const { connection } = setup();
      const pending = connection.request('initialize', {}, 1000);
      vi.advanceTimersByTime(1000);
      await expect(pending).rejects.toThrow(
        'initialize の応答が 1 秒ありませんでした',
      );
      connection.handleLine(JSON.stringify({ id: 1, result: {} }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('閉じたら、待っている要求を失敗させる', async () => {
    const { connection } = setup();
    const pending = connection.request('turn/start', {});
    connection.close(new Error('終了しました'));
    await expect(pending).rejects.toThrow('終了しました');
    await expect(connection.request('turn/start', {})).rejects.toThrow(
      '終了しました',
    );
  });
});
