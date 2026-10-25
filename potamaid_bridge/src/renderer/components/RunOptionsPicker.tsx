/**
 * モデルと思考量（reasoning effort）を選ぶ欄。
 * 新しい目標・相談のダイアログと、設定の既定の両方で使う。
 *
 * 空（null）は「既定」を表し、そのときの既定の説明を選択肢に出す。
 * プロバイダーからモデルの一覧を取得できなければ、モデル名を直接入力する欄にする。
 */
import { useId } from 'react';
import type { ModelOption, RunOptions } from '../../shared/domain';
import { effortLabel } from '../lib/runOptions';

interface RunOptionsPickerProps {
  value: RunOptions;
  onChange(value: RunOptions): void;
  models: ModelOption[];
  /** 「既定」を選んだときに使われるモデル（説明に使う） */
  defaultModel: ModelOption | undefined;
  /** 「既定」の選択肢の説明（「設定の既定」「Codex の設定」など） */
  defaultLabel: string;
}

export function RunOptionsPicker({
  value,
  onChange,
  models,
  defaultModel,
  defaultLabel,
}: RunOptionsPickerProps) {
  const modelId = useId();
  const effortId = useId();
  // 思考量の選択肢は、選んだモデル（既定ならそのモデル）が対応しているもの
  const selected = value.model
    ? models.find((m) => m.id === value.model)
    : defaultModel;
  const efforts = selected?.efforts ?? [];

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor={modelId} className="font-medium">
          モデル
        </label>
        {models.length > 0 ? (
          <select
            id={modelId}
            className="select select-sm w-full"
            value={value.model ?? ''}
            onChange={(e) =>
              // モデルを変えたら、思考量は既定に戻す（モデルごとに選べる値が違うため）
              onChange({ model: e.target.value || null, effort: null })
            }
          >
            <option value="">
              既定（{defaultModel?.displayName ?? defaultLabel}）
            </option>
            {models.map((model) => (
              <option key={model.id} value={model.id} title={model.description}>
                {model.displayName}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={modelId}
            className="input input-sm w-full font-mono"
            placeholder={`空なら${defaultLabel}`}
            value={value.model ?? ''}
            onChange={(e) =>
              onChange({ ...value, model: e.target.value || null })
            }
          />
        )}
      </div>
      <div className="flex min-w-36 flex-col gap-1">
        <label htmlFor={effortId} className="font-medium">
          思考量
        </label>
        <select
          id={effortId}
          className="select select-sm w-full"
          value={value.effort ?? ''}
          onChange={(e) =>
            onChange({ ...value, effort: e.target.value || null })
          }
        >
          <option value="">
            既定
            {selected?.defaultEffort
              ? `（${effortLabel(selected.defaultEffort)}）`
              : ''}
          </option>
          {efforts.map((effort) => (
            <option
              key={effort.id}
              value={effort.id}
              title={effort.description}
            >
              {effortLabel(effort.id)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
