import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/store/repositories/SettingsRepository';
import type { ExecutionProfile, Settings, TaskRunInfo } from './domain';
import {
  normalizeWeight,
  resolveFollowUpRun,
  resolveOwnerRun,
  resolveTaskRun,
  toRunInfo,
} from './runConfig';

const profile = (
  id: string,
  patch: Partial<ExecutionProfile> = {},
): ExecutionProfile => ({
  id,
  name: `設定 ${id}`,
  providerId: 'codex',
  model: `model-${id}`,
  effort: 'medium',
  ...patch,
});

const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  codexModel: 'bridge-model',
  codexEffort: 'low',
  profiles: [
    profile('light'),
    profile('heavy', { effort: 'high' }),
    profile('fast', { model: 'gpt-fast', effort: null }),
  ],
  ...patch,
});

const goal = (patch: Partial<Parameters<typeof resolveOwnerRun>[0]> = {}) => ({
  providerId: 'codex' as const,
  profileId: null,
  model: null,
  effort: null,
  ...patch,
});

describe('resolveTaskRun', () => {
  const project = { weightProfiles: { light: 'light', heavy: 'heavy' } };

  it('タスクで直接指定した実行の設定を最優先にする', () => {
    const run = resolveTaskRun(
      { weight: 'light', profileId: 'heavy' },
      goal({ profileId: 'fast' }),
      project,
      settings(),
    );
    expect([run.source, run.profile?.id, run.effort]).toEqual([
      'task',
      'heavy',
      'high',
    ]);
  });

  it('次に、重さに対応する実行の設定を使う', () => {
    const run = resolveTaskRun(
      { weight: 'heavy', profileId: null },
      goal({ model: 'goal-model' }),
      project,
      settings(),
    );
    expect([run.source, run.model]).toEqual(['weight', 'model-heavy']);
  });

  it('重さに対応がなければ目標の既定、なければ設定の既定を使う', () => {
    const standard = { weight: 'standard' as const, profileId: null };
    expect(
      resolveTaskRun(
        standard,
        goal({ model: 'goal-model' }),
        project,
        settings(),
      ),
    ).toMatchObject({
      source: 'goal',
      model: 'goal-model',
      // 思考量だけ指定がなければ、設定の Codex の既定を使う（以前の目標の指定と同じ）
      effort: 'low',
    });
    expect(resolveTaskRun(standard, goal(), project, settings())).toMatchObject(
      { source: 'default', model: 'bridge-model', effort: 'low' },
    );
    expect(
      resolveTaskRun(
        standard,
        goal(),
        project,
        settings({ defaultProfileId: 'fast' }),
      ),
    ).toMatchObject({
      source: 'default',
      profile: { id: 'fast' },
      model: 'gpt-fast',
    });
  });

  it('消された実行の設定は飛ばして次の段階に進む', () => {
    const run = resolveTaskRun(
      { weight: 'heavy', profileId: 'deleted' },
      goal({ profileId: 'deleted' }),
      { weightProfiles: { heavy: 'deleted' } },
      settings(),
    );
    expect(run.source).toBe('default');
  });
});

describe('resolveFollowUpRun', () => {
  const info = (patch: Partial<TaskRunInfo> = {}): TaskRunInfo => ({
    source: 'weight',
    profileId: 'heavy',
    profileName: '設定 heavy',
    providerId: 'codex',
    model: 'gpt-actual',
    effort: 'high',
    ...patch,
  });

  it('前回と同じ実行の設定で続ける', () => {
    expect(resolveFollowUpRun(info(), settings()).profile?.id).toBe('heavy');
  });

  it('実行の設定が消えていれば、記録したモデルで続ける', () => {
    expect(
      resolveFollowUpRun(info({ profileId: 'deleted' }), settings()),
    ).toMatchObject({ profile: null, model: 'gpt-actual', effort: 'high' });
  });

  it('同じ実行の設定でも、プロバイダーを変えていたら記録したモデルで続ける', () => {
    const changed = settings({
      profiles: [profile('heavy', { providerId: 'claude' })],
    });
    expect(resolveFollowUpRun(info(), changed)).toMatchObject({
      profile: null,
      providerId: 'codex',
      model: 'gpt-actual',
    });
  });
});

describe('toRunInfo', () => {
  it('プロバイダーが実際に使ったモデルを記録する', () => {
    const run = resolveOwnerRun(goal(), settings({ codexModel: '' }));
    expect(toRunInfo(run, { model: 'gpt-default', effort: null })).toEqual({
      source: 'default',
      profileId: null,
      profileName: null,
      providerId: 'codex',
      model: 'gpt-default',
      effort: 'low',
    });
  });
});

describe('normalizeWeight', () => {
  it('知らない重さは標準にする', () => {
    expect(normalizeWeight('heavy')).toBe('heavy');
    expect(normalizeWeight('extreme')).toBe('standard');
    expect(normalizeWeight(undefined)).toBe('standard');
  });
});
