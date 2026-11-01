/**
 * タスクの重さと、直接指定する実行の設定を選ぶ欄（仕様書6章）。
 * 計画の確認のタスクの編集と、未着手・失敗のタスクの詳細で使う。
 */
import { useId } from 'react';
import type { ExecutionProfile, TaskWeight } from '../../../shared/domain';
import { TASK_WEIGHTS } from '../../../shared/domain';
import { WEIGHT_META } from '../../lib/runOptions';

export function TaskRunFields({
  weight,
  profileId,
  profiles,
  onChange,
  summary,
  disabled = false,
}: {
  weight: TaskWeight;
  profileId: string | null;
  profiles: ExecutionProfile[];
  onChange(run: { weight: TaskWeight; profileId: string | null }): void;
  /** 使う設定の説明 */
  summary: string;
  disabled?: boolean;
}) {
  const weightId = useId();
  const profileSelectId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-32 flex-col gap-1">
          <label htmlFor={weightId} className="font-medium">
            重さ
          </label>
          <select
            id={weightId}
            className="select select-sm w-full"
            value={weight}
            disabled={disabled}
            onChange={(e) =>
              onChange({ weight: e.target.value as TaskWeight, profileId })
            }
          >
            {TASK_WEIGHTS.map((w) => (
              <option key={w} value={w} title={WEIGHT_META[w].description}>
                {WEIGHT_META[w].label}（{w}）
              </option>
            ))}
          </select>
        </div>
        {profiles.length > 0 && (
          <div className="flex min-w-44 flex-1 flex-col gap-1">
            <label htmlFor={profileSelectId} className="font-medium">
              実行の設定
            </label>
            <select
              id={profileSelectId}
              className="select select-sm w-full"
              value={profileId ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({ weight, profileId: e.target.value || null })
              }
            >
              <option value="">重さで決める</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <span className="text-xs text-muted">使う設定: {summary}</span>
    </div>
  );
}
