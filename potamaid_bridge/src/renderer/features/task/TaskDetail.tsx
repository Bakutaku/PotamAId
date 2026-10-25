/**
 * タスクの詳細（ボードのカードを選ぶと右に開く）。
 * 内容と依存関係、途中経過、承認、中止、追加の指示。
 * 確認は目標の単位で行うため、タスクごとの「完了にする」はない。
 */
import type { Approval, Goal, Task } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { MessageComposer } from '../../components/MessageComposer';
import { ProgressEventList } from '../../components/ProgressEventList';
import { RunningIndicator } from '../../components/RunningIndicator';
import { StatusBadge } from '../../components/StatusBadge';
import {
  dependencyText,
  describeTask,
  isGoalStarted,
} from '../../lib/selectors';
import { INVESTIGATE_META, TASK_STATUS } from '../../lib/statusMeta';
import { useProgressEvents } from '../../state/useProgressEvents';
import { useRunAction } from '../../state/Toasts';
import { useUiState } from '../../state/UiState';
import { InlineApprovals } from '../approvals/InlineApprovals';

export function TaskDetail({
  goal,
  task,
  tasks,
  approvals,
  runLabel,
}: {
  goal: Goal;
  task: Task;
  tasks: Task[];
  /** このタスクの承認待ち */
  approvals: Approval[];
  runLabel: string;
}) {
  const run = useRunAction();
  const { selectTask } = useUiState();
  const { events } = useProgressEvents({ type: 'task', id: task.id });
  const canStop = task.status === 'running' || task.status === 'approval';
  const instructable = isGoalStarted(goal);
  const investigate = task.kind === 'investigate';

  return (
    <section
      aria-label="タスクの詳細"
      className="flex w-[420px] max-w-[440px] shrink-0 flex-col border-l border-base-300 bg-base-100"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-3">
        <span className="text-xs text-muted">#{task.number}</span>
        <h2 className="text-[15px] font-bold">{task.title}</h2>
        {investigate && <StatusBadge meta={INVESTIGATE_META} />}
        <StatusBadge meta={TASK_STATUS[task.status]} />
        <span className="ml-auto" />
        {canStop && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={task.paused}
            onClick={() => void run(() => bridge.cancelTask(task.id))}
          >
            <Icon name="stop" size={14} />
            {task.paused ? '中止しています…' : '中止'}
          </button>
        )}
        {task.paused && !canStop && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void run(() => bridge.resumeTask(task.id))}
          >
            再開
          </button>
        )}
        <IconButton
          icon="close"
          label="詳細を閉じる"
          onClick={() => selectTask(null)}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        <div className="flex flex-col gap-0.5 rounded-box bg-base-200 px-3.5 py-2.5">
          <span className="text-[11px] text-muted">
            このタスクの内容（計画より）
          </span>
          <span className="whitespace-pre-wrap">{task.description}</span>
          <span className="text-[11px] text-muted">
            {dependencyText(task, tasks)}・{runLabel}
            ・専用のセッション（目標と計画を添えて開始）
          </span>
        </div>

        <ProgressEventList events={events} />

        {task.paused && !canStop && (
          <div
            role="status"
            className="rounded-box bg-base-200 px-3.5 py-3 text-muted"
          >
            停止中です。「再開」を押すか、追加の指示を送ると実行を再開します。
          </div>
        )}
        {task.status === 'todo' && !task.paused && (
          <div className="rounded-box bg-base-200 px-3.5 py-3 text-muted">
            まだ実行していません（{describeTask(task, tasks)}）。
            {investigate
              ? '調査タスクは読み取り専用なので、ほかのタスクと並行して実行します。'
              : '編集タスクは対象modごとに 1 件ずつ実行します。'}
          </div>
        )}
        {task.status === 'running' && <RunningIndicator />}

        <InlineApprovals approvals={approvals} />

        {task.needsGameRestart && task.status === 'done' && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-box bg-success/15 px-3.5 py-2.5 text-success-strong"
          >
            <Icon name="restart" />
            反映にはゲームの再起動が必要です
          </div>
        )}

        {task.status === 'failed' && (
          <div className="flex flex-wrap items-center gap-2 rounded-box border border-error/40 px-3.5 py-3">
            <span className="text-error-strong">
              {task.error ?? '失敗しました'}
            </span>
            <button
              type="button"
              className="btn btn-sm ml-auto"
              onClick={() => void run(() => bridge.retryTask(task.id))}
            >
              やり直す
            </button>
          </div>
        )}

        {task.pendingInstructions > 0 && (
          <div className="text-xs text-muted">
            追加の指示 {task.pendingInstructions} 件を順番待ちしています
          </div>
        )}
      </div>

      <MessageComposer
        label="このタスクに指示する"
        placeholder={
          !instructable
            ? '計画を承認すると指示できます'
            : investigate
              ? 'GUI のクラスも調べて'
              : '処理時間を半分にして'
        }
        disabled={!instructable || (canStop && task.paused)}
        onSubmit={(text) =>
          run(() => bridge.sendTaskInstruction(task.id, text))
        }
      />
    </section>
  );
}
