import { useEffect, useState } from 'react';
import type {
  Project,
  ProviderStatus,
  RunOptions,
  Settings,
} from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { RunOptionsPicker } from '../../components/RunOptionsPicker';
import { TextPromptDialog } from '../../components/TextPromptDialog';
import { defaultModelOf } from '../../lib/runOptions';
import { useRunAction } from '../../state/Toasts';
import { useUiState } from '../../state/UiState';

/** 新しい目標を書くダイアログ。作ると AI が計画を作り始める */
export function NewGoalDialog({
  project,
  settings,
  provider,
}: {
  project: Project | null;
  settings: Settings;
  /** 使うプロバイダー（モデルの選択肢に使う） */
  provider: ProviderStatus | undefined;
}) {
  const { state, closeDialog, showView } = useUiState();
  const run = useRunAction();
  const open = state.dialog === 'newGoal' && project !== null;
  const [options, setOptions] = useState<RunOptions>(EMPTY_OPTIONS);

  // 開くたびに既定に戻す
  useEffect(() => {
    if (open) {
      setOptions(EMPTY_OPTIONS);
    }
  }, [open]);

  return (
    <TextPromptDialog
      open={open}
      title={`新しい目標（${project?.name ?? ''}）`}
      label="実装したいこと"
      description="AI が読み取り専用でコードを調べ、タスクに分けた計画を作ります。計画は確認・編集してから承認します。"
      placeholder="鉄鉱石を2倍にする粉砕機を追加したい。かまどと同じ見た目で、側面だけ変える"
      submitLabel="計画を作る"
      onClose={closeDialog}
      onSubmit={(text) =>
        run(async () => {
          if (!project) {
            return;
          }
          const goal = await bridge.createGoal(project.id, text, options);
          showView({ kind: 'goal', id: goal.id }, project.id);
        })
      }
    >
      <RunOptionsPicker
        value={options}
        onChange={setOptions}
        models={provider?.models ?? []}
        profiles={settings.profiles}
        defaultModel={defaultModelOf(settings, provider)}
        defaultLabel="設定の既定"
      />
      <p className="text-xs text-muted">
        目標の既定です。計画の作成と、重さに対応する実行の設定を決めていないタスクで使います。
      </p>
    </TextPromptDialog>
  );
}

const EMPTY_OPTIONS: RunOptions = {
  profileId: null,
  model: null,
  effort: null,
};
