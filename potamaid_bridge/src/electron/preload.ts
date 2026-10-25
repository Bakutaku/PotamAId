/**
 * 画面に `window.bridge` を公開する。
 *
 * contextIsolation を有効にしているため、画面からは Node.js や ipcRenderer を直接使えない。
 * 操作の一覧（BRIDGE_API_METHODS）から、IPC の呼び出しを機械的に組み立てる。
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  BRIDGE_API_METHODS,
  BRIDGE_EVENT_NAMES,
  eventChannel,
  invokeChannel,
  type BridgeClient,
  type BridgeEventName,
  type BridgeEvents,
} from '../shared/ipc';

const api = Object.fromEntries(
  BRIDGE_API_METHODS.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(invokeChannel(method), ...args),
  ]),
);

const client: BridgeClient = {
  ...(api as unknown as Omit<BridgeClient, 'on'>),
  on<E extends BridgeEventName>(
    event: E,
    listener: (payload: BridgeEvents[E]) => void,
  ) {
    if (!BRIDGE_EVENT_NAMES.includes(event)) {
      throw new Error(`不明なイベントです: ${event}`);
    }
    const channel = eventChannel(event);
    const handler = (_: Electron.IpcRendererEvent, payload: BridgeEvents[E]) =>
      listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld('bridge', client);
