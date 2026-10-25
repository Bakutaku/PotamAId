/**
 * Bridge の状態（スナップショット）を画面全体で共有する。
 *
 * 最初に取得し、そのあとは main からのプッシュで置き換える。
 * React からは {@link useBridgeSnapshot} で読む。
 */
import { useSyncExternalStore } from 'react';
import type { BridgeSnapshot } from '../../shared/ipc';
import { bridge } from '../api/bridge';

let current: BridgeSnapshot | null = null;
const listeners = new Set<() => void>();

const setSnapshot = (snapshot: BridgeSnapshot) => {
  current = snapshot;
  listeners.forEach((listener) => listener());
};

bridge.on('snapshot', setSnapshot);
void bridge.getSnapshot().then((snapshot) => {
  // プッシュの方が先に届いていたら、そちらを使う
  if (!current) {
    setSnapshot(snapshot);
  }
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Bridge の状態。最初の取得が終わるまでは null */
export function useBridgeSnapshot(): BridgeSnapshot | null {
  return useSyncExternalStore(subscribe, () => current);
}
