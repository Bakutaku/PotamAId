import { describe, expect, it } from 'vitest';
import { parsePlan } from './planSchema';
import { checkTaskGraph, sortByDependencies } from './taskGraph';

const task = (key: string, dependsOn: string[] = []) => ({
  key,
  title: `タスク ${key}`,
  description: '',
  dependsOn,
});

const plan = (tasks: ReturnType<typeof task>[]) =>
  JSON.stringify({ goalTitle: '粉砕機', summary: '要約', tasks });

describe('parsePlan', () => {
  it('正しい計画を読み、依存先が先に来るように並べる', () => {
    const result = parsePlan(
      plan([task('t2', ['t1']), task('t1'), task('t3', ['t2'])]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasks.map((t) => t.key)).toEqual(['t1', 't2', 't3']);
      expect(result.value.goalTitle).toBe('粉砕機');
    }
  });

  it('コードブロックで囲まれた JSON も読む', () => {
    const result = parsePlan(`\`\`\`json\n${plan([task('t1')])}\n\`\`\``);
    expect(result.ok).toBe(true);
  });

  it('JSON でなければ失敗する', () => {
    expect(parsePlan('計画です').ok).toBe(false);
    expect(parsePlan(null).ok).toBe(false);
  });

  it('タスクがなければ失敗する', () => {
    expect(parsePlan(plan([])).ok).toBe(false);
  });

  it('識別子の重複・存在しない参照・循環を見つける', () => {
    expect(parsePlan(plan([task('t1'), task('t1')]))).toMatchObject({
      ok: false,
      error: expect.stringContaining('重複'),
    });
    expect(parsePlan(plan([task('t1', ['t9'])]))).toMatchObject({
      ok: false,
      error: expect.stringContaining('存在しない'),
    });
    expect(
      parsePlan(plan([task('t1', ['t2']), task('t2', ['t1'])])),
    ).toMatchObject({ ok: false, error: expect.stringContaining('循環') });
  });
});

describe('checkTaskGraph', () => {
  it('自分自身への依存を見つける', () => {
    expect(checkTaskGraph([{ id: 'a', dependsOn: ['a'] }]).ok).toBe(false);
  });

  it('循環しているタスクを順に返す', () => {
    const result = checkTaskGraph([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['c'] },
      { id: 'c', dependsOn: ['a'] },
    ]);
    expect(result).toMatchObject({ ok: false, taskIds: ['a', 'b', 'c', 'a'] });
  });
});

describe('sortByDependencies', () => {
  it('依存関係で決まらない順番は元のまま保つ', () => {
    const sorted = sortByDependencies([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['a'] },
    ]);
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});
