/**
 * 計画の確認（仕様書3章「目標の進め方」）。
 * タスクの編集・削除・追加、指示を足しての作り直し、承認ができる。
 */
import { useState } from 'react';
import type { Goal, Task } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { ChatBubble } from '../../components/ChatBubble';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { TextPromptDialog } from '../../components/TextPromptDialog';
import { GOAL_STATUS } from '../../lib/statusMeta';
import { useRunAction } from '../../state/Toasts';
import { PlanTaskEditor } from './PlanTaskEditor';
import { PlanTaskItem } from './PlanTaskItem';

/** 編集中のタスク。null は追加、undefined は閉じている */
type Editing = Task | null | undefined;

export function PlanReview({ goal, tasks }: { goal: Goal; tasks: Task[] }) {
  const run = useRunAction();
  const [editing, setEditing] = useState<Editing>(undefined);
  const [replanOpen, setReplanOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const approve = async () => {
    setApproving(true);
    await run(() => bridge.approvePlan(goal.id));
    setApproving(false);
  };

  return (
    <section
      aria-label="計画の確認"
      className="flex max-w-[820px] flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-[17px] font-bold">{goal.title}</h1>
        <StatusBadge meta={GOAL_STATUS.planReview} />
      </div>
      <ChatBubble from="user" text={goal.text} />
      {goal.planSummary && <ChatBubble from="ai" text={goal.planSummary} />}
      <div role="note" className="rounded-field bg-info/10 px-3 py-2.5">
        必要ならタスクを直してから承認してください。承認すると依存関係の順に実行し、すべて終わったらお知らせします。
      </div>
      {goal.planError && (
        <div role="alert" className="alert alert-error alert-soft">
          前回の作り直しに失敗しました: {goal.planError}
        </div>
      )}

      <ol className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <PlanTaskItem
            key={task.id}
            task={task}
            tasks={tasks}
            onEdit={() => setEditing(task)}
            onRemove={() => void run(() => bridge.removePlanTask(task.id))}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setEditing(null)}
        className="btn btn-sm self-start border-dashed border-base-300 bg-transparent"
      >
        <Icon name="plus" size={14} />
        タスクを追加
      </button>

      <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
        <button
          type="button"
          onClick={() => setReplanOpen(true)}
          className="btn btn-sm"
        >
          指示を足して作り直す
        </button>
        <button
          type="button"
          disabled={approving || tasks.length === 0}
          onClick={() => void approve()}
          className="btn btn-primary btn-sm"
        >
          計画を承認して開始
        </button>
      </div>

      <PlanTaskEditor
        open={editing !== undefined}
        task={editing ?? null}
        tasks={tasks}
        onClose={() => setEditing(undefined)}
        onSave={(input) =>
          run(() =>
            editing
              ? bridge.updatePlanTask(editing.id, input)
              : bridge.addPlanTask(goal.id, input),
          )
        }
      />
      <TextPromptDialog
        open={replanOpen}
        title="指示を足して作り直す"
        label="追加の指示"
        description="いまの計画（編集した内容を含む）を AI に渡して、作り直してもらいます。"
        placeholder="GUI は後回しにして、先にレシピを作って"
        submitLabel="作り直す"
        onClose={() => setReplanOpen(false)}
        onSubmit={(text) => run(() => bridge.regeneratePlan(goal.id, text))}
      />
    </section>
  );
}
