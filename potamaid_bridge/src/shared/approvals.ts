/**
 * 承認待ちの表示に使う関数（Bridge の本体と画面の両方で使う）。
 */
import type { Approval } from './domain';

type ApprovalSummary = Pick<
  Approval,
  'kind' | 'command' | 'files' | 'questions' | 'source'
>;

/** 承認待ちの短い説明（ボードのカード・途中経過・承認待ちの枠に出す） */
export function describeApproval(approval: ApprovalSummary): string {
  switch (approval.kind) {
    case 'command':
      return approval.command ?? 'コマンドの実行';
    case 'fileChange':
      return approval.files.length > 0
        ? `${approval.files.join('、')} の変更`
        : 'ファイルの変更';
    case 'question': {
      const first = approval.questions[0];
      return `質問: ${first?.header || first?.question || 'AI からの質問'}`;
    }
    case 'form':
      return `入力の要求: ${approval.source ?? 'MCP'}`;
    case 'url':
      return `URL を開く要求: ${approval.source ?? 'MCP'}`;
  }
}

/** 許可・拒否で答える種類か（質問・フォーム・URL は内容を添えて答える） */
export function isPermissionRequest(approval: Pick<Approval, 'kind'>): boolean {
  return approval.kind === 'command' || approval.kind === 'fileChange';
}
