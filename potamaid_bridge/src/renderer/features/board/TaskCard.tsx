import type { Task } from '../../../shared/domain';
import { StatusBadge } from '../../components/StatusBadge';
import { describeTask } from '../../lib/selectors';
import { INVESTIGATE_META, TASK_STATUS } from '../../lib/statusMeta';

/** ボードのタスクのカード。選ぶと右に詳細を開く */
export function TaskCard({
  task,
  tasks,
  compact,
  selected,
  onSelect,
}: {
  task: Task;
  /** 同じ目標のタスク（補足の文の計算に使う） */
  tasks: Task[];
  compact: boolean;
  selected: boolean;
  onSelect(): void;
}) {
  const subtitle = compact ? '' : describeTask(task, tasks);
  const border = selected
    ? 'border-primary ring-1 ring-primary'
    : task.status === 'approval'
      ? 'border-warning'
      : 'border-base-300';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-1 rounded-[calc(var(--radius-box)-4px)] border bg-base-100 text-left hover:border-primary/60 ${border} ${
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'
      }`}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="text-[11px] text-muted">#{task.number}</span>
        <span className="min-w-0 flex-1 font-medium">{task.title}</span>
        {task.kind === 'investigate' && <StatusBadge meta={INVESTIGATE_META} />}
        <StatusBadge meta={TASK_STATUS[task.status]} />
      </span>
      {subtitle && (
        <span className="line-clamp-2 text-xs text-muted">{subtitle}</span>
      )}
    </button>
  );
}
