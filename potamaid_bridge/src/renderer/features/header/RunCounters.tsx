import type { RunCounts } from '../../../shared/ipc';

/** 実行中の数（編集を伴うタスクは対象modごとに1件、計画・相談は上限まで） */
export function RunCounters({ runs }: { runs: RunCounts | undefined }) {
  if (!runs) {
    return null;
  }
  return (
    <>
      <span
        title="ファイルを編集するタスクは、対象modごとに 1 件ずつ実行します"
        className="badge rounded-selector border-0 bg-info/15 text-info-strong"
      >
        編集 {runs.edit} / 1
      </span>
      <span
        title="計画づくりと相談は読み取り専用なので並行して実行します"
        className="badge rounded-selector border-0 bg-base-200 text-muted"
      >
        計画・相談 {runs.readOnly} / {runs.readOnlyLimit}
        {runs.queued > 0 && `（順番待ち ${runs.queued}）`}
      </span>
    </>
  );
}
