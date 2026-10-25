import { useEffect, useRef, type RefObject } from 'react';
import type { BridgeSnapshot } from '../../shared/ipc';
import { bridge } from '../api/bridge';
import { useUiState } from './UiState';

/**
 * トレイのメニューなど、main から頼まれた画面の操作を行う。
 * @param approvalsRef 「承認待ちを確認」でフォーカスを移す、承認待ちの枠
 */
export function useUiCommands(
  snapshot: BridgeSnapshot,
  approvalsRef: RefObject<HTMLElement | null>,
): void {
  const ui = useUiState();
  // 購読し直さずに最新の値を使うため、ref に入れておく
  const latest = useRef({ snapshot, ui });
  latest.current = { snapshot, ui };

  useEffect(
    () =>
      bridge.on('uiCommand', (command) => {
        const { snapshot: s, ui: u } = latest.current;
        switch (command.type) {
          case 'openSettings':
            u.openDialog('settings');
            break;
          case 'showApprovals': {
            const first = s.approvals[0];
            if (first) {
              u.selectProject(first.projectId);
            }
            // 対象modを切り替えたあとの描画を待ってから、枠へ移る
            setTimeout(() => {
              approvalsRef.current?.focus();
              approvalsRef.current?.scrollIntoView({ block: 'start' });
            }, 0);
            break;
          }
        }
      }),
    [approvalsRef],
  );
}
