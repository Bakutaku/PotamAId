/**
 * 反映待ちの目標の枠（仕様書3章「worktree での並行実行」）。
 * タスクはすべて終わっていて、ゲームを起動するディレクトリへの反映を待っている。
 * 理由を出し、コミットなどを済ませたら「反映する」でやり直せる。
 */
import { useState } from 'react';
import type { Goal } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { useRunAction } from '../../state/Toasts';

export function GoalWaitingPanel({ goal }: { goal: Goal }) {
  const run = useRunAction();
  const [integrating, setIntegrating] = useState(false);

  const integrate = async () => {
    setIntegrating(true);
    await run(() => bridge.integrateGoal(goal.id));
    setIntegrating(false);
  };

  return (
    <section
      aria-label="反映待ち"
      className="flex animate-fade-in flex-col gap-2 rounded-box border border-warning/60 bg-warning/5 px-3.5 py-3"
    >
      <div className="font-bold">
        タスクがすべて終わりました。ゲームを起動するディレクトリへの反映を待っています
      </div>
      {goal.waitReason && <div className="text-xs">{goal.waitReason}</div>}
      <div className="text-xs text-muted">
        変更は目標のブランチ {goal.branch}{' '}
        にあります。反映すると、コミットしない変更として置きます。
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={integrating}
          onClick={() => void integrate()}
        >
          反映する
        </button>
      </div>
    </section>
  );
}
