/**
 * 目標のボード。選んだ目標のタスクを状態ごとの列に並べる。
 */
import type { Goal, Task } from '../../../shared/domain';
import { StatusBadge } from '../../components/StatusBadge';
import { goalDisplayStatus, goalProgress } from '../../lib/selectors';
import { GOAL_STATUS } from '../../lib/statusMeta';
import { useUiState } from '../../state/UiState';
import { BOARD_COLUMNS } from './boardColumns';
import { BoardColumn } from './BoardColumn';

export function GoalBoard({
  goal,
  tasks,
  selectedTaskId,
}: {
  goal: Goal;
  tasks: Task[];
  selectedTaskId: string | null;
}) {
  const { selectTask } = useUiState();
  const progress = goalProgress(tasks);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[17px] font-bold">{goal.title}</h1>
          <StatusBadge meta={GOAL_STATUS[goalDisplayStatus(goal, tasks)]} />
          <span className="text-muted">
            {progress.done} / {progress.total} 完了
          </span>
          {/* 実行の途中で計画を変える方法は仕様が未決定のため、まだ使えない */}
          <button
            type="button"
            disabled
            title="実行の途中で計画を変える方法は未決定のため、まだ使えません"
            className="btn btn-sm ml-auto"
          >
            計画を見直す
          </button>
        </div>
        <p className="text-muted whitespace-pre-wrap">{goal.text}</p>
      </div>
      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            items={tasks.filter((t) => column.statuses.includes(t.status))}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={(taskId) => selectTask(taskId)}
          />
        ))}
      </div>
    </>
  );
}
