import type { BridgeClient } from '../shared/ipc';

declare global {
  interface Window {
    /** preload が公開する Bridge の操作（src/electron/preload.ts） */
    bridge: BridgeClient;
  }
}
