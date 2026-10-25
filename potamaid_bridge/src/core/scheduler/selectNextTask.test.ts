import { describe, expect, it } from 'vitest';
import type { Goal, Task, TaskStatus } from '../../shared/domain';
import { selectNextTask } from './selectNextTask';

const goal = (id: string, status: Goal['status'] = 'active'): Goal => ({
  id,
  projectId: 'p',
  title: id,
  text: id,
  status,
  planSummary: null,
  planError: null,
  providerId: 'codex',
  model: null,
  effort: null,
  createdAt: 0,
});

const task = (
  id: string,
  goalId: string,
  number: number,
  status: TaskStatus = 'todo',
  dependsOn: string[] = [],
  pendingInstructions = 0,
): Task => ({
  id,
  goalId,
  number,
  title: id,
  description: '',
  dependsOn,
  status,
  latest: null,
  result: null,
  needsGameRestart: false,
  error: null,
  pendingInstructions,
  startedAt: null,
  finishedAt: null,
});

describe('selectNextTask', () => {
  it('依存先がすべて完了した未着手のタスクを番号順に選ぶ', () => {
    const tasks = [
      task('a', 'g', 1, 'done'),
      task('b', 'g', 2, 'todo', ['c']),
      task('c', 'g', 3, 'todo', ['a']),
    ];
    expect(selectNextTask([goal('g')], tasks)?.id).toBe('c');
  });

  it('実行中のタスクがあれば何も始めない', () => {
    const tasks = [task('a', 'g', 1, 'approval'), task('b', 'g', 2)];
    expect(selectNextTask([goal('g')], tasks)).toBeNull();
  });

  it('確認待ちがあれば、新しいタスクは始めない', () => {
    const tasks = [task('a', 'g', 1, 'review'), task('b', 'g', 2)];
    expect(selectNextTask([goal('g')], tasks)).toBeNull();
  });

  it('確認待ちのタスクへの追加の指示は実行する', () => {
    const tasks = [task('a', 'g', 1, 'review', [], 1), task('b', 'g', 2)];
    expect(selectNextTask([goal('g')], tasks)?.id).toBe('a');
  });

  it('確認待ちがある間は、完了したタスクへの追加の指示を待たせる', () => {
    const tasks = [
      task('a', 'g', 1, 'done', [], 1),
      task('b', 'g', 2, 'review'),
    ];
    expect(selectNextTask([goal('g')], tasks)).toBeNull();
  });

  it('計画を承認していない目標のタスクは選ばない', () => {
    const tasks = [task('a', 'g1', 1), task('b', 'g2', 1)];
    expect(
      selectNextTask([goal('g1', 'planReview'), goal('g2')], tasks)?.id,
    ).toBe('b');
  });

  it('目標の作成順を優先する', () => {
    const tasks = [task('late', 'g2', 1), task('early', 'g1', 5)];
    expect(selectNextTask([goal('g1'), goal('g2')], tasks)?.id).toBe('early');
  });

  it('失敗したタスクに依存するタスクは実行しない', () => {
    const tasks = [
      task('a', 'g', 1, 'failed'),
      task('b', 'g', 2, 'todo', ['a']),
    ];
    expect(selectNextTask([goal('g')], tasks)).toBeNull();
  });

  it('未送信の指示が残っていても、失敗したタスクを自動で再試行しない', () => {
    expect(
      selectNextTask([goal('g')], [task('a', 'g', 1, 'failed', [], 1)]),
    ).toBeNull();
  });
});
