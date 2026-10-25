/**
 * 計画を作っている間と、計画の作成に失敗したときの表示。
 */
import type { Approval, Goal } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { ChatBubble } from '../../components/ChatBubble';
import { ProgressEventList } from '../../components/ProgressEventList';
import { RunningIndicator } from '../../components/RunningIndicator';
import { StatusBadge } from '../../components/StatusBadge';
import { GOAL_STATUS } from '../../lib/statusMeta';
import { useProgressEvents } from '../../state/useProgressEvents';
import { useRunAction } from '../../state/Toasts';
import { InlineApprovals } from '../approvals/InlineApprovals';

export function GoalPlanningView({
  goal,
  runLabel,
  approvals,
}: {
  goal: Goal;
  /** 使う AI の説明（プロバイダー・モデル・思考量） */
  runLabel: string;
  /** 計画づくりの承認待ち（AI からの質問など） */
  approvals: Approval[];
}) {
  const run = useRunAction();
  const { events } = useProgressEvents({ type: 'goal', id: goal.id });
  // 依頼文は上に吹き出しで出すので、途中経過からは除く
  const progress = events.filter(
    (e) => !(e.kind === 'user' && e.text === goal.text),
  );
  const failed = goal.status === 'planFailed';

  return (
    <section
      aria-label="計画の作成"
      className="flex max-w-[820px] flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-[17px] font-bold">{goal.title}</h1>
        <StatusBadge meta={GOAL_STATUS[goal.status]} />
        <span className="text-xs text-muted">{runLabel}</span>
      </div>
      <ChatBubble from="user" text={goal.text} />
      <ProgressEventList events={progress} />
      <InlineApprovals approvals={approvals} />
      {!failed && (
        // 読み取り専用の実行枠が空いていなければ、順番待ちのあとに始まる
        <RunningIndicator label="AI がコードを読んで計画を作っています…" />
      )}
      {failed && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-error-strong">
            {goal.planError ?? '計画の作成に失敗しました'}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm ml-auto"
            onClick={() => void run(() => bridge.retryPlan(goal.id))}
          >
            やり直す
          </button>
        </div>
      )}
    </section>
  );
}
