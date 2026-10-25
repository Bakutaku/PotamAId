import { useState } from 'react';
import type { Goal, Task } from '../../../shared/domain';
import {
  isGoalWorkFinished,
  restartRequiredTasks,
} from '../../../shared/goals';
import { bridge } from '../../api/bridge';
import { Icon } from '../../components/Icon';
import { TextPromptDialog } from '../../components/TextPromptDialog';
import { useRunAction } from '../../state/Toasts';

/**
 * 目標の確認の枠（仕様書3章「確認と修正の指示」）。確認中・完了の目標のボードの上に出す。
 * 再起動が必要なタスク、目標の「完了にする」、目標への修正の指示。
 */
export function GoalReviewPanel({
  goal,
  tasks,
}: {
  goal: Goal;
  tasks: Task[];
}) {
  const run = useRunAction();
  const [instructOpen, setInstructOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const finished = isGoalWorkFinished(tasks);
  const restart = finished ? restartRequiredTasks(goal, tasks) : [];

  const complete = async () => {
    setCompleting(true);
    await run(() => bridge.markGoalDone(goal.id));
    setCompleting(false);
  };

  const [heading, detail] =
    goal.status === 'done'
      ? [
          'この目標は完了しています',
          '直したい点があれば、修正を指示できます。目標は確認中に戻ります。',
        ]
      : finished
        ? [
            'ゲーム内や VS Code で動作を確かめてください',
            '直してほしい点は、修正を指示するか、原因のタスクを選んで指示できます。',
          ]
        : ['修正を実行しています', '終わったら、もう一度お知らせします。'];

  return (
    <section
      aria-label="目標の確認"
      className={`flex flex-col gap-2 rounded-box border px-3.5 py-3 ${
        goal.status === 'review' && finished
          ? 'border-accent/60 bg-accent/5'
          : 'border-base-300'
      }`}
    >
      <div className="font-bold">{heading}</div>
      <div className="text-xs text-muted">{detail}</div>
      {restart.length > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-field bg-success/15 px-3 py-2 text-success-strong"
        >
          <Icon name="restart" />
          反映にはゲームの再起動が必要です（
          {restart.map((t) => `#${t.number}`).join('・')}）
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setInstructOpen(true)}
        >
          修正を指示する
        </button>
        {goal.status === 'review' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!finished || completing}
            onClick={() => void complete()}
          >
            <Icon name="check" size={14} />
            完了にする
          </button>
        )}
      </div>
      <TextPromptDialog
        open={instructOpen}
        title="修正を指示する"
        label="直してほしい点"
        description="修正のタスクを目標に追加して実行します。それまでのタスクの結果を添えて、新しいセッションで直します。"
        placeholder="鉄鉱石が2倍にならない"
        submitLabel="指示する"
        onClose={() => setInstructOpen(false)}
        onSubmit={(text) =>
          run(() => bridge.sendGoalInstruction(goal.id, text))
        }
      />
    </section>
  );
}
