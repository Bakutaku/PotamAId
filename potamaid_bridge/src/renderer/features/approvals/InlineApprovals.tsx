import type { Approval } from '../../../shared/domain';
import { ApprovalCard } from './ApprovalCard';

/** タスクの詳細・相談・計画づくりの画面の中に出す、その持ち主の承認待ち */
export function InlineApprovals({ approvals }: { approvals: Approval[] }) {
  return (
    <>
      {approvals.map((approval) => (
        <div
          key={approval.id}
          role="alert"
          className="rounded-box border border-warning bg-warning/12 px-3.5 py-3"
        >
          <ApprovalCard approval={approval} />
        </div>
      ))}
    </>
  );
}
