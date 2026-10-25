/**
 * モデルと思考量の表示。
 */
import type {
  ModelOption,
  ProviderStatus,
  Settings,
} from '../../shared/domain';

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

/**
 * 目標・相談で実際に使うモデルと思考量の説明（「gpt-x・思考量 中」など）。
 * 指定がなければ設定の既定、それもなければプロバイダーの既定として出す。
 */
export function describeRun(
  run: { model: string | null; effort: string | null },
  settings: Settings,
  provider: ProviderStatus | undefined,
): string {
  const models = provider?.models ?? [];
  const modelId = run.model ?? (settings.codexModel || null);
  const model = modelId
    ? models.find((m) => m.id === modelId)
    : defaultModelOf(settings, provider);
  const modelName = model?.displayName ?? modelId ?? '既定のモデル';
  const effort =
    run.effort ?? (settings.codexEffort || null) ?? model?.defaultEffort;
  return effort ? `${modelName}・思考量 ${effortLabel(effort)}` : modelName;
}
