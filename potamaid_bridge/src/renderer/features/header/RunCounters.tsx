import type { RunCounts } from '../../../shared/ipc';
import { StatusDot } from '../../components/StatusDot';

/** 実行中の数（編集タスクも読み取り専用の実行も、対象modごとの上限まで） */
export function RunCounters({ runs }: { runs: RunCounts | undefined }) {
  if (!runs) {
    return null;
  }
  return (
    <>
      <span
        title="編集タスクは、目標ごとの worktree で、設定の上限まで並行して実行します"
        className="badge gap-1.5 rounded-selector border-0 bg-info/15 text-info-strong"
      >
        {runs.edit > 0 && <StatusDot tone="info" pulse />}
        編集 {runs.edit} / {runs.editLimit}
      </span>
      <span
        title="計画づくり・調査タスク・相談は読み取り専用なので並行して実行します"
        className="badge gap-1.5 rounded-selector border-0 bg-base-200 text-muted"
      >
        {runs.readOnly > 0 && <StatusDot tone="info" pulse />}
        読み取り {runs.readOnly} / {runs.readOnlyLimit}
        {runs.queued > 0 && `（順番待ち ${runs.queued}）`}
      </span>
    </>
  );
}
