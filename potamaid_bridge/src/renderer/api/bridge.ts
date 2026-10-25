/**
 * Bridge の本体への操作の入口。画面のコードは window.bridge を直接使わず、ここを通す。
 */
import type { BridgeClient } from '../../shared/ipc';

export const bridge: BridgeClient = window.bridge;

/**
 * IPC のエラーから、利用者に見せるメッセージを取り出す。
 * Electron は "Error invoking remote method 'bridge:x': Error: ..." の形にするため、前置きを外す。
 */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
}
