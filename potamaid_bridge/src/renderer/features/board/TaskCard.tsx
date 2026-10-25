import type { Task } from '../../../shared/domain';
import { StatusBadge } from '../../components/StatusBadge';
import { describeTask } from '../../lib/selectors';
import { INVESTIGATE_META, TASK_STATUS } from '../../lib/statusMeta';

/** ボードのタスクのカード。選ぶと右に詳細を開く */
export function TaskCard({
  task,
  tasks,
  compact,
  showStatus,
  selected,
  onSelect,
}: {
  task: Task;
  /** 同じ目標のタスク（補足の文の計算に使う） */
  tasks: Task[];
  compact: boolean;
  /** 状態のバッジを出すか */
  showStatus: boolean;
  selected: boolean;
  onSelect(): void;
}) {
  const subtitle = compact ? '' : describeTask(task, tasks);
  const approval = task.status === 'approval';
  const border = selected
    ? 'border-primary ring-1 ring-primary'
    : approval
      ? 'border-warning'
      : 'border-base-300';
  // 承認待ちは枠を光らせる。それ以外は、列を移ると作り直されるので、
  // そのたびに弾ませて出し、移ったことに気付けるようにする
  const animation =
    approval && !selected ? 'animate-glow-warning' : 'animate-pop-in';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex w-full flex-col gap-1 overflow-hidden rounded-[calc(var(--radius-box)-4px)] border bg-base-100 text-left transition duration-150 hover:-translate-y-px hover:border-primary/60 hover:shadow-md active:translate-y-0 ${animation} ${border} ${
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'
      }`}
    >
      {task.status === 'running' && (
        // 応答中のカードの下端に、流れる光を出す
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden motion-reduce:hidden"
        >
          <span className="block h-full w-2/5 animate-flow bg-linear-to-r from-transparent via-info to-transparent" />
        </span>
      )}
      <span className="flex w-full items-center gap-1.5">
        <span className="text-[11px] text-muted">#{task.number}</span>
        <span className="min-w-0 flex-1 font-medium">{task.title}</span>
        {task.kind === 'investigate' && <StatusBadge meta={INVESTIGATE_META} />}
        {showStatus && <StatusBadge meta={TASK_STATUS[task.status]} />}
      </span>
      {subtitle && (
        <span className="line-clamp-2 text-xs text-muted">{subtitle}</span>
      )}
    </button>
  );
}
