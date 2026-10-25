import { useEffect, useState } from 'react';
import type { ProgressEvent, ProgressOwner } from '../../shared/domain';
import type { StreamingText } from '../../shared/ipc';
import { bridge } from '../api/bridge';

export interface ProgressState {
  events: ProgressEvent[];
  /** ストリームで届いている途中の AI の発言 */
  streaming: StreamingText | null;
  loading: boolean;
}

/**
 * 目標・タスク・相談の途中経過。開いたときにまとめて取得し、あとはプッシュで追記する。
 */
export function useProgressEvents(owner: ProgressOwner | null): ProgressState {
  const [state, setState] = useState<ProgressState>({
    events: [],
    streaming: null,
    loading: true,
  });
  const type = owner?.type;
  const id = owner?.id;

  useEffect(() => {
    if (!type || !id) {
      setState({ events: [], streaming: null, loading: false });
      return;
    }
    const matches = (o: ProgressOwner) => o.type === type && o.id === id;
    let active = true;
    setState({ events: [], streaming: null, loading: true });

    // 取得中に届いたプッシュも取りこぼさないよう、先に購読してから取得し、連番で重複を除く
    const offProgress = bridge.on('progress', (event) => {
      if (!matches({ type: event.ownerType, id: event.ownerId })) {
        return;
      }
      setState((s) => ({
        ...s,
        events: mergeEvents(s.events, [event]),
        // AI の発言が確定したら、ストリームの表示を消す
        streaming: event.kind === 'agent' ? null : s.streaming,
      }));
    });
    const offStreaming = bridge.on('streaming', (text) => {
      if (matches(text.owner)) {
        setState((s) => ({ ...s, streaming: text }));
      }
    });
    void bridge.getProgressEvents({ type, id }).then((events) => {
      if (active) {
        setState((s) => ({
          ...s,
          events: mergeEvents(events, s.events),
          loading: false,
        }));
      }
    });

    return () => {
      active = false;
      offProgress();
      offStreaming();
    };
  }, [type, id]);

  return state;
}

/** 連番で重複を除き、順に並べる */
function mergeEvents(a: ProgressEvent[], b: ProgressEvent[]): ProgressEvent[] {
  const bySeq = new Map<number, ProgressEvent>();
  for (const event of [...a, ...b]) {
    bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq);
}
