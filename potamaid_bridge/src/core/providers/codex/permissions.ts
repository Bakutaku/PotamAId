/**
 * Bridge の権限の考え方（{@link AccessMode}）を、Codex の設定に対応付ける。
 *
 * - 計画の作成・相談: 読み取り専用。承認を求めず、許可されない操作は失敗させる
 *   （承認で権限を広げないため）
 * - タスクの実行: 作業ディレクトリの中は編集でき、サンドボックスの外の操作は承認を求める
 */
import type { AccessMode } from '../AiProvider';
import type { AskForApproval } from './protocol/v2/AskForApproval';
import type { SandboxMode } from './protocol/v2/SandboxMode';

export interface CodexPermissions {
  sandbox: SandboxMode;
  approvalPolicy: AskForApproval;
}

export const CODEX_PERMISSIONS: Record<AccessMode, CodexPermissions> = {
  readOnly: { sandbox: 'read-only', approvalPolicy: 'never' },
  workspaceWrite: { sandbox: 'workspace-write', approvalPolicy: 'on-request' },
};
