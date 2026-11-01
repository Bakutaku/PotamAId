/**
 * タスク・目標・相談に使う実行の設定の決め方（仕様書6章「実行の設定とモデルの選び方」）。
 *
 * タスクは、タスクで直接指定したもの → 重さに対応する実行の設定 → 目標の既定 → Bridge の設定の既定 の順で決める。
 * 計画の作成と相談は、目標・相談の既定 → Bridge の設定の既定 の順で決める。
 * 消された実行の設定を指していたら、次の段階に進む。
 *
 * Bridge の本体と画面（計画の確認で、どの設定を使うかの表示）の両方で使う。
 */
import type {
  ExecutionProfile,
  Project,
  ProviderId,
  RunSource,
  Settings,
  Task,
  TaskRunInfo,
  TaskWeight,
} from './domain';
import { TASK_WEIGHTS } from './domain';

/** 決めた実行の設定 */
export interface ResolvedRun {
  source: RunSource;
  /** 使う実行の設定。モデルを直接指定したときは null */
  profile: ExecutionProfile | null;
  providerId: ProviderId;
  /** null はプロバイダーの既定 */
  model: string | null;
  effort: string | null;
}

/** 実行の設定の既定を持つもの（目標・相談） */
export interface RunDefaults {
  providerId: ProviderId;
  profileId: string | null;
  model: string | null;
  effort: string | null;
}

export function findProfile(
  settings: Pick<Settings, 'profiles'>,
  id: string | null | undefined,
): ExecutionProfile | undefined {
  return id ? settings.profiles.find((p) => p.id === id) : undefined;
}

export function fromProfile(
  profile: ExecutionProfile,
  source: RunSource,
): ResolvedRun {
  return {
    source,
    profile,
    providerId: profile.providerId,
    model: profile.model,
    effort: profile.effort,
  };
}

/** Bridge の設定の既定 */
export function resolveDefaultRun(settings: Settings): ResolvedRun {
  const profile = findProfile(settings, settings.defaultProfileId);
  if (profile) {
    return fromProfile(profile, 'default');
  }
  return {
    source: 'default',
    profile: null,
    providerId: 'codex',
    model: settings.codexModel.trim() || null,
    effort: settings.codexEffort.trim() || null,
  };
}

/**
 * 目標・相談の既定（計画の作成と相談に使う）。
 * モデルか思考量だけを指定したときは、指定しなかった方に Bridge の設定の Codex の既定を使う
 * （以前の仕様の、目標に持たせていたモデルと思考量と同じ扱い）
 */
export function resolveOwnerRun(
  owner: RunDefaults,
  settings: Settings,
): ResolvedRun {
  const profile = findProfile(settings, owner.profileId);
  if (profile) {
    return fromProfile(profile, 'goal');
  }
  if (owner.model || owner.effort) {
    return {
      source: 'goal',
      profile: null,
      providerId: owner.providerId,
      model: owner.model ?? (settings.codexModel.trim() || null),
      effort: owner.effort ?? (settings.codexEffort.trim() || null),
    };
  }
  return resolveDefaultRun(settings);
}

/** タスクに使う実行の設定 */
export function resolveTaskRun(
  task: Pick<Task, 'profileId' | 'weight'>,
  goal: RunDefaults,
  project: Pick<Project, 'weightProfiles'>,
  settings: Settings,
): ResolvedRun {
  const direct = findProfile(settings, task.profileId);
  if (direct) {
    return fromProfile(direct, 'task');
  }
  const byWeight = findProfile(settings, project.weightProfiles[task.weight]);
  if (byWeight) {
    return fromProfile(byWeight, 'weight');
  }
  return resolveOwnerRun(goal, settings);
}

/**
 * 追加の指示で、同じセッションの続きを実行するときの設定。
 * 同じセッションではプロバイダーと接続先を変えられないため、前回の実行の設定を使う。
 * 実行の設定が消えたかプロバイダーが変わっていたら、記録したモデルで実行する
 */
export function resolveFollowUpRun(
  info: TaskRunInfo,
  settings: Settings,
): ResolvedRun {
  const profile = findProfile(settings, info.profileId);
  if (profile && profile.providerId === info.providerId) {
    return fromProfile(profile, info.source);
  }
  return {
    source: info.source,
    profile: null,
    providerId: info.providerId,
    model: info.model,
    effort: info.effort,
  };
}

/** 決めた実行の設定を、タスクに記録する形にする */
export function toRunInfo(
  run: ResolvedRun,
  actual: { model?: string | null; effort?: string | null } = {},
): TaskRunInfo {
  return {
    source: run.source,
    profileId: run.profile?.id ?? null,
    profileName: run.profile?.name ?? null,
    providerId: run.providerId,
    model: actual.model || run.model,
    effort: actual.effort || run.effort,
  };
}

/** 画面などから届いた重さ。知らない値は標準として扱う */
export function normalizeWeight(weight: unknown): TaskWeight {
  return TASK_WEIGHTS.includes(weight as TaskWeight)
    ? (weight as TaskWeight)
    : 'standard';
}
