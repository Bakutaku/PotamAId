/**
 * モデル・思考量・実行の設定・タスクの重さの表示。
 */
import type {
  Consult,
  Goal,
  ModelOption,
  Project,
  ProviderStatus,
  RunSource,
  Settings,
  Task,
  TaskRunInfo,
  TaskWeight,
} from '../../shared/domain';
import {
  resolveOwnerRun,
  resolveTaskRun,
  type ResolvedRun,
} from '../../shared/runConfig';

/**
 * 思考量（reasoning effort）の表示名。
 * 段階が多く日本語だけでは区別しにくいため、Codex の値も括弧で添える。知らない値はそのまま出す
 */
const EFFORT_LABELS: Record<string, string> = {
  none: 'なし',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '特高',
  max: '最大',
  ultra: '超最大',
};

export function effortLabel(effort: string): string {
  const label = EFFORT_LABELS[effort];
  return label ? `${label}（${effort}）` : effort;
}

/** タスクの重さの表示名と説明 */
export const WEIGHT_META: Record<
  TaskWeight,
  { label: string; description: string }
> = {
  light: { label: '軽い', description: '翻訳の追加や単純な登録など' },
  standard: { label: '標準', description: 'ふつうの実装や調査' },
  heavy: {
    label: '重い',
    description: '複数のファイルにまたがる設計や、分かりにくい不具合',
  },
  max: { label: '最大', description: '全体の設計を左右する、特に難しいもの' },
};

/** 実行の設定をどこから決めたか */
const SOURCE_LABELS: Record<RunSource, string> = {
  task: 'タスクで指定',
  weight: '重さから',
  goal: '目標の既定',
  default: '設定の既定',
};

/** 設定の既定のモデル。設定が空ならプロバイダーの既定のモデル */
export function defaultModelOf(
  settings: Settings,
  provider: ProviderStatus | undefined,
): ModelOption | undefined {
  const models = provider?.models ?? [];
  return (
    models.find((m) => m.id === settings.codexModel) ??
    models.find((m) => m.isDefault)
  );
}

/** モデルと思考量の説明（「gpt-x・思考量 中」など）。モデルが null ならプロバイダーの既定として出す */
function describeModel(
  modelId: string | null,
  effort: string | null,
  provider: ProviderStatus | undefined,
): string {
  const models = provider?.models ?? [];
  const model = modelId
    ? models.find((m) => m.id === modelId)
    : models.find((m) => m.isDefault);
  const modelName = model?.displayName ?? modelId ?? '既定のモデル';
  const shownEffort = effort ?? model?.defaultEffort;
  return shownEffort
    ? `${modelName}・思考量 ${effortLabel(shownEffort)}`
    : modelName;
}

/** 決めた実行の設定の説明（「重い: gpt-x・思考量 高」など） */
export function describeResolved(
  run: ResolvedRun,
  provider: ProviderStatus | undefined,
): string {
  const model = describeModel(run.model, run.effort, provider);
  return run.profile ? `${run.profile.name}: ${model}` : model;
}

/** 目標・相談で使う実行の設定の説明 */
export function describeRun(
  target: Goal | Consult,
  settings: Settings,
  provider: ProviderStatus | undefined,
): string {
  return describeResolved(resolveOwnerRun(target, settings), provider);
}

/** まだ実行していないタスクで使う予定の実行の設定の説明 */
export function describeTaskPlan(
  task: Pick<Task, 'weight' | 'profileId'>,
  goal: Goal,
  project: Project | undefined,
  settings: Settings,
  provider: ProviderStatus | undefined,
): string {
  const run = resolveTaskRun(
    task,
    goal,
    project ?? { weightProfiles: {} },
    settings,
  );
  return `${describeResolved(run, provider)}（${SOURCE_LABELS[run.source]}）`;
}

/** 実際に使った実行の設定とモデルの説明 */
export function describeRunInfo(
  info: TaskRunInfo,
  provider: ProviderStatus | undefined,
): string {
  const model = describeModel(info.model, info.effort, provider);
  return info.profileName ? `${info.profileName}: ${model}` : model;
}

/** ボードのカードに出す、短い実行の設定とモデルの名前（「重い・gpt-x」など） */
export function shortRunLabel(info: TaskRunInfo): string {
  return (
    [info.profileName, info.model].filter(Boolean).join('・') || '既定のモデル'
  );
}
