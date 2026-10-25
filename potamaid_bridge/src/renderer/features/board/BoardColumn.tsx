import type { Task } from '../../../shared/domain';
import { StatusDot } from '../../components/StatusDot';
import type { BoardColumnDef } from './boardColumns';
import { TaskCard } from './TaskCard';

/** ボードの1列 */
export function BoardColumn({
  column,
  items,
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  column: BoardColumnDef;
  /** この列に並べるタスク */
  items: Task[];
  /** 目標のすべてのタスク */
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask(taskId: string): void;
}) {
  return (
    <section
      aria-label={column.title}
      style={{ flexGrow: column.grow, flexBasis: 0 }}
      className={`flex shrink flex-col gap-2 rounded-box bg-base-300 p-2.5 ${column.minWidthClass}`}
    >
      <h2 className="flex items-center gap-2 px-1 py-0.5 text-[13px] font-bold">
        <StatusDot tone={column.tone} />
        {column.title}
        <span className="ml-auto font-normal text-muted">{items.length}</span>
      </h2>
      {items.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          tasks={tasks}
          compact={column.compact}
          selected={task.id === selectedTaskId}
          onSelect={() => onSelectTask(task.id)}
        />
      ))}
      {items.length === 0 && (
        <div className="rounded-[calc(var(--radius-box)-4px)] border border-dashed border-base-content/25 p-3 text-center text-xs text-muted">
          なし
        </div>
      )}
    </section>
  );
}
