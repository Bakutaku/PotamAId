/**
 * ボードの上の「承認待ち」の枠（仕様書5章「アプリの画面」）。
 * どの目標を見ていても気付けるように、対象modの承認待ち（許可・AI からの質問・
 * MCP の入力要求）をすべて出し、その場で回答できるようにする。
 */
import type { Ref } from 'react';
import type { Approval } from '../../../shared/domain';
import type { BridgeSnapshot } from '../../../shared/ipc';
import { Icon } from '../../components/Icon';
import { useUiState } from '../../state/UiState';
import { ApprovalCard } from './ApprovalCard';

export function ApprovalBanner({
  snapshot,
  approvals,
  ref,
}: {
  snapshot: BridgeSnapshot;
  approvals: Approval[];
  /** トレイの「承認待ちを確認」で、この枠にフォーカスを移すのに使う */
  ref?: Ref<HTMLElement>;
}) {
  if (approvals.length === 0) {
    return null;
  }
  return (
    <section
      ref={ref}
      aria-label="承認待ち"
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-box border border-warning bg-warning/12 px-3.5 py-3"
    >
      <h2 className="flex items-center gap-2 text-sm font-bold text-warning-strong">
        <Icon name="shield" size={18} />
        承認待ち {approvals.length} 件
        <span className="text-xs font-normal text-muted">
          AI はあなたの対応を待って止まっています
        </span>
      </h2>
      {approvals.map((approval) => (
        <div
          key={approval.id}
          className="flex flex-col gap-2 rounded-field bg-base-100 px-3 py-2.5"
        >
          <OwnerLine snapshot={snapshot} approval={approval} />
          <ApprovalCard approval={approval} />
        </div>
      ))}
    </section>
  );
}

/** 承認を求めているもの（タスク・相談・計画づくり）と、そこへ移るボタン */
function OwnerLine({
  snapshot,
  approval,
}: {
  snapshot: BridgeSnapshot;
  approval: Approval;
}) {
  const { selectTask, showView } = useUiState();
  const { owner, projectId } = approval;

  let context = '';
  let title = '';
  let open: () => void = () => undefined;
  if (owner.type === 'task') {
    const task = snapshot.tasks.find((t) => t.id === owner.id);
    const goal = snapshot.goals.find((g) => g.id === task?.goalId);
    context = goal?.title ?? '';
    title = task ? `#${task.number} ${task.title}` : '';
    open = () =>
      task && selectTask(task.id, { goalId: task.goalId, projectId });
  } else if (owner.type === 'consult') {
    context = '相談';
    title = snapshot.consults.find((c) => c.id === owner.id)?.title ?? '';
    open = () => showView({ kind: 'consult', id: owner.id }, projectId);
  } else {
    context = '計画の作成';
    title = snapshot.goals.find((g) => g.id === owner.id)?.title ?? '';
    open = () => showView({ kind: 'goal', id: owner.id }, projectId);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="flex flex-col leading-snug">
        <span className="text-[11px] text-muted">{context}</span>
        <span className="font-bold">{title}</span>
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm ml-auto"
        onClick={open}
      >
        詳細
      </button>
    </div>
  );
}
