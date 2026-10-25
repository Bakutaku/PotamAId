import type { Goal, Task } from '../../../shared/domain';
import { ProgressBar } from '../../components/ProgressBar';
import { goalDisplayStatus, goalProgress } from '../../lib/selectors';
import { GOAL_STATUS } from '../../lib/statusMeta';
import { TEXT_CLASS } from '../../lib/tone';

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
  const progressText =
    goal.status === 'planReview'
      ? `${progress.total} タスクを提案`
      : goal.status === 'active'
        ? `${progress.done} / ${progress.total}`
        : '';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full flex-col gap-1 rounded-field px-2.5 py-2 text-left hover:bg-base-200 ${
        selected ? 'bg-primary/15 hover:bg-primary/20' : ''
      }`}
    >
      <span className="font-medium">{goal.title}</span>
      {progressText && (
        <span className="flex items-center gap-2 text-[11px] text-muted">
          <ProgressBar
            percent={goal.status === 'active' ? progress.percent : 0}
            label={`${goal.title} の進み具合`}
          />
          {progressText}
        </span>
      )}
      <span className={`text-[11px] ${TEXT_CLASS[meta.tone]}`}>
        {meta.label}
      </span>
    </button>
  );
}
