import type { Task } from '../../../shared/domain';
import { IconButton } from '../../components/IconButton';
import { StatusBadge } from '../../components/StatusBadge';
import { dependencyText } from '../../lib/selectors';
import { INVESTIGATE_META } from '../../lib/statusMeta';

/** 計画の確認のタスクの1件 */
export function PlanTaskItem({
  task,
  tasks,
  onEdit,
  onRemove,
}: {
  task: Task;
  tasks: Task[];
  onEdit(): void;
  onRemove(): void;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-field border border-base-300 px-3 py-2.5">
      <span className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-bold">
        {task.number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 font-medium">
          {task.title}
          {task.kind === 'investigate' && (
            <StatusBadge meta={INVESTIGATE_META} />
          )}
        </span>
        <span className="text-xs whitespace-pre-wrap text-muted">
          {task.description}
        </span>
        <span className="text-[11px] text-muted">
          {dependencyText(task, tasks)}
        </span>
      </span>
      <IconButton
        icon="edit"
        label={`#${task.number} を編集`}
        onClick={onEdit}
      />
      <IconButton
        icon="close"
        label={`#${task.number} を削除`}
        onClick={onRemove}
      />
    </li>
  );
}
