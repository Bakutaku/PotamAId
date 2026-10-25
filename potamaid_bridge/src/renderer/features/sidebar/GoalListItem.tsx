import type { Goal, Task } from '../../../shared/domain';
import { ProgressBar } from '../../components/ProgressBar';
import {
  goalDisplayStatus,
  goalProgress,
  isGoalStarted,
} from '../../lib/selectors';
import { GOAL_STATUS } from '../../lib/statusMeta';
import { TEXT_CLASS } from '../../lib/tone';
import { SELECTABLE_ITEM_CLASS, SELECTED_ITEM_CLASS } from './itemClasses';

/** サイドバーの目標の1件（題名・進み具合・状態） */
export function GoalListItem({
  goal,
  tasks,
  selected,
  onSelect,
}: {
  goal: Goal;
  tasks: Task[];
  selected: boolean;
  onSelect(): void;
}) {
  const meta = GOAL_STATUS[goalDisplayStatus(goal, tasks)];
  const progress = goalProgress(tasks);
  const started = isGoalStarted(goal);
  const progressText =
    goal.status === 'planReview'
      ? `${progress.total} タスクを提案`
      : started
        ? `${progress.done} / ${progress.total}`
        : '';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`${SELECTABLE_ITEM_CLASS} flex-col gap-1 py-2 ${
        selected ? SELECTED_ITEM_CLASS : ''
      }`}
    >
      <span className="line-clamp-2 leading-snug font-medium">
        {goal.title}
      </span>
      {/* 状態と進み具合を1行にまとめる */}
      <span className="flex items-center gap-2 text-[11px] text-muted">
        <span className={`shrink-0 ${TEXT_CLASS[meta.tone]}`}>
          {meta.label}
        </span>
        {started && (
          <ProgressBar
            percent={progress.percent}
            label={`${goal.title} の進み具合`}
          />
        )}
        {progressText && (
          <span className={`shrink-0 ${started ? '' : 'ml-auto'}`}>
            {progressText}
          </span>
        )}
      </span>
    </button>
  );
}
