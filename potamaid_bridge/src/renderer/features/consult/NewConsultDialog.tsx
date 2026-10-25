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

/** 新しい相談を始めるダイアログ */
export function NewConsultDialog({
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
  const open = state.dialog === 'newConsult' && project !== null;
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
      title={`新しい相談（${project?.name ?? ''}）`}
      label="聞きたいこと"
      description="相談は読み取り専用で、ファイルは変更しません。"
      placeholder="ブロックエンティティのデータをクライアントに同期する仕組みを教えて"
      submitLabel="相談する"
      onClose={closeDialog}
      onSubmit={(text) =>
        run(async () => {
          if (!project) {
            return;
          }
          const consult = await bridge.createConsult(project.id, text, options);
          showView({ kind: 'consult', id: consult.id }, project.id);
        })
      }
    >
      <RunOptionsPicker
        value={options}
        onChange={setOptions}
        models={provider?.models ?? []}
        defaultModel={defaultModelOf(settings, provider)}
        defaultLabel="設定の既定"
      />
    </TextPromptDialog>
  );
}

const EMPTY_OPTIONS: RunOptions = { model: null, effort: null };
