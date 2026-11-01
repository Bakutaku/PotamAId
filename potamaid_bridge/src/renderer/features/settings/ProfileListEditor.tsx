/**
 * 実行の設定（プロファイル）の一覧の編集（仕様書6章「実行の設定とモデルの選び方」）。
 * プロバイダー・モデル・思考量の組に名前を付けて登録する。
 * 保存は設定のダイアログの「保存」でまとめて行う。
 */
import { useId } from 'react';
import type { ExecutionProfile, ModelOption } from '../../../shared/domain';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { EffortSelect } from '../../components/RunOptionsPicker';

export function ProfileListEditor({
  profiles,
  onChange,
  models,
}: {
  profiles: ExecutionProfile[];
  onChange(profiles: ExecutionProfile[]): void;
  /** Codex のモデルの一覧 */
  models: ModelOption[];
}) {
  const update = (index: number, patch: Partial<ExecutionProfile>) =>
    onChange(profiles.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const add = () =>
    onChange([
      ...profiles,
      {
        id: crypto.randomUUID(),
        name: `設定 ${profiles.length + 1}`,
        providerId: 'codex',
        model: null,
        effort: null,
      },
    ]);

  return (
    <div className="flex flex-col gap-2">
      {profiles.length === 0 && (
        <p className="text-xs text-muted">
          まだありません。モデルと思考量の組に名前を付けて登録すると、タスクの重さごとに使い分けられます。
        </p>
      )}
      {profiles.map((profile, index) => (
        <ProfileItem
          key={profile.id}
          profile={profile}
          models={models}
          onChange={(patch) => update(index, patch)}
          onRemove={() => onChange(profiles.filter((_, i) => i !== index))}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="btn btn-xs self-start border-dashed border-base-300 bg-transparent"
      >
        <Icon name="plus" size={13} />
        実行の設定を追加
      </button>
    </div>
  );
}

function ProfileItem({
  profile,
  models,
  onChange,
  onRemove,
}: {
  profile: ExecutionProfile;
  models: ModelOption[];
  onChange(patch: Partial<ExecutionProfile>): void;
  onRemove(): void;
}) {
  const ids = {
    name: useId(),
    model: useId(),
    effort: useId(),
  };
  const selected = profile.model
    ? models.find((m) => m.id === profile.model)
    : models.find((m) => m.isDefault);

  return (
    <div className="flex flex-col gap-2 rounded-field border border-base-300 p-2.5">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={ids.name} className="text-xs font-medium">
            名前
          </label>
          <input
            id={ids.name}
            value={profile.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="input input-sm w-full"
          />
        </div>
        <IconButton
          icon="close"
          label={`${profile.name} を削除`}
          onClick={onRemove}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={ids.model} className="text-xs font-medium">
            モデル
          </label>
          {models.length > 0 ? (
            <select
              id={ids.model}
              value={profile.model ?? ''}
              onChange={(e) =>
                onChange({ model: e.target.value || null, effort: null })
              }
              className="select select-sm w-full"
            >
              <option value="">
                Codex の既定
                {selected ? `（${selected.displayName}）` : ''}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={ids.model}
              value={profile.model ?? ''}
              placeholder="空なら Codex の既定"
              onChange={(e) => onChange({ model: e.target.value || null })}
              className="input input-sm w-full font-mono"
            />
          )}
        </div>
        <div className="flex min-w-36 flex-col gap-1">
          <label htmlFor={ids.effort} className="text-xs font-medium">
            思考量
          </label>
          <EffortSelect
            id={ids.effort}
            value={profile.effort}
            efforts={selected?.efforts ?? []}
            defaultEffort={selected?.defaultEffort ?? null}
            onChange={(effort) => onChange({ effort })}
          />
        </div>
      </div>
    </div>
  );
}
