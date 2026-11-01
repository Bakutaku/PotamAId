/**
 * 設定: Codex の実行ファイル・実行の設定（プロファイル）と既定・タイムアウト・通知、
 * 対象modの名前・同時実行数・重さごとの実行の設定。
 * テーマはヘッダーのボタンで切り替える。
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type {
  ExecutionProfile,
  Project,
  ProviderStatus,
  RunOptions,
  Settings,
  WeightProfiles,
} from '../../../shared/domain';
import { TASK_WEIGHTS } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { Dialog } from '../../components/Dialog';
import { RunOptionsPicker } from '../../components/RunOptionsPicker';
import { StatusDot } from '../../components/StatusDot';
import { WEIGHT_META } from '../../lib/runOptions';
import { PROVIDER_STATE_TONE } from '../../lib/statusMeta';
import { useRunAction } from '../../state/Toasts';
import { useUiState } from '../../state/UiState';
import { ProfileListEditor } from './ProfileListEditor';

/** 読み取り専用の同時実行数の範囲（Bridge の本体と同じ） */
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

export function SettingsDialog({
  settings,
  project,
  providers,
}: {
  settings: Settings;
  project: Project | null;
  providers: ProviderStatus[];
}) {
  const { state, closeDialog } = useUiState();
  const run = useRunAction();
  const open = state.dialog === 'settings';
  const [codexPath, setCodexPath] = useState('');
  const [codexRun, setCodexRun] = useState<RunOptions>({
    profileId: null,
    model: null,
    effort: null,
  });
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [weightProfiles, setWeightProfiles] = useState<WeightProfiles>({});
  const [requestTimeout, setRequestTimeout] = useState(60);
  const [idleTimeout, setIdleTimeout] = useState(10);
  const [notifications, setNotifications] = useState(true);
  const [projectName, setProjectName] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [editConcurrency, setEditConcurrency] = useState(1);
  const ids = {
    path: useId(),
    request: useId(),
    idle: useId(),
    name: useId(),
    limit: useId(),
    editLimit: useId(),
  };
  const codex = providers.find((p) => p.id === 'codex');

  // 開いたときだけ、いまの設定を入れ直す
  // （開いている間に状態が届いても、入力中の内容を消さないため open だけを見る）
  useEffect(() => {
    if (open) {
      setCodexPath(settings.codexPath);
      setCodexRun({
        profileId: settings.defaultProfileId,
        model: settings.codexModel || null,
        effort: settings.codexEffort || null,
      });
      setProfiles(settings.profiles);
      setWeightProfiles(project?.weightProfiles ?? {});
      setRequestTimeout(settings.requestTimeoutSeconds);
      setIdleTimeout(settings.turnIdleTimeoutMinutes);
      setNotifications(settings.desktopNotifications);
      setProjectName(project?.name ?? '');
      setConcurrency(project?.readOnlyConcurrency ?? 2);
      setEditConcurrency(project?.editConcurrency ?? 1);
    }
  }, [open]); // oxlint-disable-line react-hooks/exhaustive-deps

  const save = () =>
    run(async () => {
      // 消した実行の設定は、既定と重さの対応からも外す
      const exists = (id: string | null | undefined) =>
        !!id && profiles.some((p) => p.id === id);
      await bridge.updateSettings({
        codexPath,
        profiles,
        defaultProfileId: exists(codexRun.profileId)
          ? codexRun.profileId
          : null,
        // 実行の設定を既定にしたときも、モデルと思考量の既定は残す
        ...(codexRun.profileId
          ? {}
          : {
              codexModel: codexRun.model ?? '',
              codexEffort: codexRun.effort ?? '',
            }),
        requestTimeoutSeconds: requestTimeout,
        turnIdleTimeoutMinutes: idleTimeout,
        desktopNotifications: notifications,
      });
      if (project) {
        await bridge.updateProject(project.id, {
          name: projectName,
          readOnlyConcurrency: concurrency,
          editConcurrency,
          weightProfiles: Object.fromEntries(
            Object.entries(weightProfiles).filter(([, id]) => exists(id)),
          ),
        });
      }
      closeDialog();
    });

  return (
    <Dialog
      open={open}
      title="設定"
      onClose={closeDialog}
      actions={
        <>
          <button type="button" className="btn btn-sm" onClick={closeDialog}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void save()}
          >
            保存
          </button>
        </>
      }
    >
      <SettingsSection title="AI プロバイダー">
        <ul className="flex flex-col gap-1">
          {providers.map((provider) => (
            <li key={provider.id} className="flex items-center gap-2">
              <StatusDot tone={PROVIDER_STATE_TONE[provider.state]} />
              <span className="font-medium">{provider.displayName}</span>
              <span className="text-muted">{provider.message}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-xs self-start"
          onClick={() => void run(() => bridge.refreshProviders())}
        >
          状態を確かめ直す
        </button>
        <Field id={ids.path} label="Codex の実行ファイル">
          <input
            id={ids.path}
            value={codexPath}
            placeholder="空なら PATH の codex を使います"
            onChange={(e) => setCodexPath(e.target.value)}
            className="input input-sm w-full font-mono"
          />
        </Field>
        <p className="text-xs text-muted">
          ログインは Bridge では行いません。ターミナルで codex login
          を実行してください。
        </p>
      </SettingsSection>

      <SettingsSection title="実行の設定">
        <ProfileListEditor
          profiles={profiles}
          onChange={setProfiles}
          models={codex?.models ?? []}
        />
        <h4 className="mt-1 font-medium">既定</h4>
        <RunOptionsPicker
          value={codexRun}
          onChange={setCodexRun}
          models={codex?.models ?? []}
          profiles={profiles}
          defaultModel={codex?.models.find((m) => m.isDefault)}
          defaultLabel="Codex の設定"
        />
        <p className="text-xs text-muted">
          新しい目標・相談の既定です。目標・相談を作るときに変えられます。
        </p>
      </SettingsSection>

      <SettingsSection title="タイムアウト">
        <div className="flex flex-wrap gap-3">
          <Field id={ids.request} label="要求の応答（秒）">
            <input
              id={ids.request}
              type="number"
              min={5}
              max={600}
              value={requestTimeout}
              onChange={(e) => setRequestTimeout(Number(e.target.value))}
              className="input input-sm w-28"
            />
          </Field>
          <Field id={ids.idle} label="ターン中の無応答（分）">
            <input
              id={ids.idle}
              type="number"
              min={1}
              max={240}
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(Number(e.target.value))}
              className="input input-sm w-28"
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Codex の起動やセッションの開始に応答がないとき、またはターンの途中で
          Codex
          から何も届かない状態が続いたときに、失敗にします。承認待ちの間は数えません。
        </p>
      </SettingsSection>

      <SettingsSection title="通知">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
          デスクトップ通知を出す
        </label>
        <p className="text-xs text-muted">
          目標のタスクがすべて終わったとき、承認待ちになったとき、タスクが失敗したときに知らせます。Bridge
          のウィンドウを見ている間は出しません。
        </p>
      </SettingsSection>

      {project && (
        <SettingsSection title={`対象mod（${project.name}）`}>
          <p className="text-xs break-all text-muted">{project.rootPath}</p>
          <Field id={ids.name} label="表示名">
            <input
              id={ids.name}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="input input-sm w-full"
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Field id={ids.editLimit} label="編集タスクの同時実行数">
              <input
                id={ids.editLimit}
                type="number"
                min={MIN_CONCURRENCY}
                max={MAX_CONCURRENCY}
                value={editConcurrency}
                onChange={(e) => setEditConcurrency(Number(e.target.value))}
                className="input input-sm w-24"
              />
            </Field>
            <Field id={ids.limit} label="読み取り専用の同時実行数">
              <input
                id={ids.limit}
                type="number"
                min={MIN_CONCURRENCY}
                max={MAX_CONCURRENCY}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="input input-sm w-24"
              />
            </Field>
          </div>
          <p className="text-xs text-muted">
            編集タスクは目標ごとの worktree
            で実行し、別の目標の編集タスクとこの数まで並行します（1
            つの目標の中では 1
            件ずつ）。並行すると、プランの利用枠も速く使います。計画の作成・調査タスク・相談は、読み取り専用の数まで並行します。
          </p>
          <WeightProfilesEditor
            value={weightProfiles}
            onChange={setWeightProfiles}
            profiles={profiles}
          />
        </SettingsSection>
      )}
    </Dialog>
  );
}

/** タスクの重さごとに使う実行の設定 */
function WeightProfilesEditor({
  value,
  onChange,
  profiles,
}: {
  value: WeightProfiles;
  onChange(value: WeightProfiles): void;
  profiles: ExecutionProfile[];
}) {
  const baseId = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium">タスクの重さごとの実行の設定</legend>
      {TASK_WEIGHTS.map((weight) => (
        <div key={weight} className="flex items-center gap-2">
          <label htmlFor={`${baseId}-${weight}`} className="w-16 shrink-0">
            {WEIGHT_META[weight].label}
          </label>
          <select
            id={`${baseId}-${weight}`}
            className="select select-sm flex-1"
            value={value[weight] ?? ''}
            onChange={(e) =>
              onChange({ ...value, [weight]: e.target.value || undefined })
            }
          >
            <option value="">目標の既定</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <p className="text-xs text-muted">
        AI
        が計画のときにタスクへ付けた重さで、使う実行の設定を決めます。「目標の既定」の重さは、目標を作るときに選んだものを使います。
      </p>
    </fieldset>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
