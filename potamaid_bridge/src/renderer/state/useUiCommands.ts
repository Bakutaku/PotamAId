import { useEffect, useRef, type RefObject } from 'react';
import type { BridgeSnapshot } from '../../shared/ipc';
import { bridge } from '../api/bridge';
import { useUiState } from './UiState';

/**
 * トレイのメニューや通知など、main から頼まれた画面の操作を行う。
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
            const projectId =
              command.projectId ?? s.approvals[0]?.projectId ?? null;
            if (projectId) {
              u.selectProject(projectId);
            }
            // 対象modを切り替えたあとの描画を待ってから、枠へ移る
            setTimeout(() => {
              approvalsRef.current?.focus();
              approvalsRef.current?.scrollIntoView({ block: 'start' });
            }, 0);
            break;
          }
          case 'showGoal':
            if (command.taskId) {
              u.selectTask(command.taskId, {
                goalId: command.goalId,
                projectId: command.projectId,
              });
            } else {
              u.showView(
                { kind: 'goal', id: command.goalId },
                command.projectId,
              );
            }
            break;
        }
      }),
    [approvalsRef],
  );
}
