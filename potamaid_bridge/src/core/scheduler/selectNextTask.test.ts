import { describe, expect, it } from 'vitest';
import type { Goal, Task, TaskKind, TaskStatus } from '../../shared/domain';
import {
  selectNextEditTask,
  selectNextInvestigateTask,
} from './selectNextTask';

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
  roundStartedAt: null,
  createdAt: 0,
});

const task = (
  id: string,
  goalId: string,
  number: number,
  status: TaskStatus = 'todo',
  dependsOn: string[] = [],
  pendingInstructions = 0,
  kind: TaskKind = 'edit',
): Task => ({
  id,
  goalId,
  number,
  title: id,
  description: '',
  kind,
  dependsOn,
  status,
  paused: false,
  latest: null,
  result: null,
  needsGameRestart: false,
  error: null,
  pendingInstructions,
  startedAt: null,
  finishedAt: null,
});

const investigation = (
  id: string,
  goalId: string,
  number: number,
  status: TaskStatus = 'todo',
  dependsOn: string[] = [],
) => task(id, goalId, number, status, dependsOn, 0, 'investigate');

describe('selectNextEditTask', () => {
  it('依存先がすべて完了した未着手のタスクを番号順に選ぶ', () => {
    const tasks = [
      task('a', 'g', 1, 'done'),
      task('b', 'g', 2, 'todo', ['c']),
      task('c', 'g', 3, 'todo', ['a']),
    ];
    expect(selectNextEditTask([goal('g')], tasks)?.id).toBe('c');
  });

  it('実行中の編集タスクがあれば何も始めない', () => {
    const tasks = [task('a', 'g', 1, 'approval'), task('b', 'g', 2)];
    expect(selectNextEditTask([goal('g')], tasks)).toBeNull();
  });

  it('実行中の調査タスクがあっても、編集タスクを始める', () => {
    const tasks = [investigation('a', 'g', 1, 'running'), task('b', 'g', 2)];
    expect(selectNextEditTask([goal('g')], tasks)?.id).toBe('b');
  });

  it('調査タスクは選ばない', () => {
    expect(
      selectNextEditTask([goal('g')], [investigation('a', 'g', 1)]),
    ).toBeNull();
  });

  it('完了したタスクを待たずに、次のタスクに進む', () => {
    const tasks = [task('a', 'g', 1, 'done'), task('b', 'g', 2, 'todo', ['a'])];
    expect(selectNextEditTask([goal('g')], tasks)?.id).toBe('b');
  });

  it('追加の指示を待つ依存先は、その指示が終わるまで完了とみなさない', () => {
    const tasks = [
      task('a', 'g', 1, 'done', [], 1, 'investigate'),
      task('b', 'g', 2, 'todo', ['a']),
    ];
    expect(selectNextEditTask([goal('g')], tasks)).toBeNull();
  });

  it('完了したタスクへの追加の指示を優先する', () => {
    const tasks = [task('a', 'g', 1, 'done', [], 1), task('b', 'g', 2)];
    expect(selectNextEditTask([goal('g')], tasks)?.id).toBe('a');
  });

  it('確認中の目標があれば、別の目標の編集タスクは始めない', () => {
    const tasks = [task('a', 'g1', 1, 'done'), task('b', 'g2', 1)];
    expect(
      selectNextEditTask([goal('g1', 'review'), goal('g2')], tasks),
    ).toBeNull();
  });

  it('確認中の目標の修正は実行する', () => {
    const tasks = [
      task('a', 'g1', 1, 'done'),
      task('fix', 'g1', 2, 'todo', ['a']),
      task('b', 'g2', 1),
    ];
    expect(
      selectNextEditTask([goal('g2'), goal('g1', 'review')], tasks)?.id,
    ).toBe('fix');
  });

  it('完了にした目標のタスクは選ばない', () => {
    const tasks = [task('a', 'g1', 1, 'done', [], 1), task('b', 'g2', 1)];
    expect(
      selectNextEditTask([goal('g1', 'done'), goal('g2')], tasks)?.id,
    ).toBe('b');
  });

  it('計画を承認していない目標のタスクは選ばない', () => {
    const tasks = [task('a', 'g1', 1), task('b', 'g2', 1)];
    expect(
      selectNextEditTask([goal('g1', 'planReview'), goal('g2')], tasks)?.id,
    ).toBe('b');
  });

  it('目標の作成順を優先する', () => {
    const tasks = [task('late', 'g2', 1), task('early', 'g1', 5)];
    expect(selectNextEditTask([goal('g1'), goal('g2')], tasks)?.id).toBe(
      'early',
    );
  });

  it('失敗したタスクに依存するタスクは実行せず、依存しないタスクは実行する', () => {
    const tasks = [
      task('a', 'g', 1, 'failed'),
      task('b', 'g', 2, 'todo', ['a']),
      task('c', 'g', 3),
    ];
    expect(selectNextEditTask([goal('g')], tasks)?.id).toBe('c');
  });

  it('未送信の指示が残っていても、失敗したタスクを自動で再試行しない', () => {
    expect(
      selectNextEditTask([goal('g')], [task('a', 'g', 1, 'failed', [], 1)]),
    ).toBeNull();
  });
});

describe('selectNextInvestigateTask', () => {
  it('実行中のものを除いて、依存先が完了した調査タスクを選ぶ', () => {
    const tasks = [
      investigation('a', 'g', 1, 'running'),
      investigation('b', 'g', 2),
      investigation('c', 'g', 3),
    ];
    expect(
      selectNextInvestigateTask([goal('g')], tasks, new Set(['b']))?.id,
    ).toBe('c');
  });

  it('実行中の編集タスクがあっても選ぶ', () => {
    const tasks = [task('a', 'g', 1, 'running'), investigation('b', 'g', 2)];
    expect(selectNextInvestigateTask([goal('g')], tasks, new Set())?.id).toBe(
      'b',
    );
  });

  it('確認中の目標があっても、別の目標の調査タスクを選ぶ', () => {
    const tasks = [task('a', 'g1', 1, 'done'), investigation('b', 'g2', 1)];
    expect(
      selectNextInvestigateTask(
        [goal('g1', 'review'), goal('g2')],
        tasks,
        new Set(),
      )?.id,
    ).toBe('b');
  });

  it('依存先の編集タスクが完了するまで待つ', () => {
    const tasks = [
      task('a', 'g', 1),
      investigation('b', 'g', 2, 'todo', ['a']),
    ];
    expect(selectNextInvestigateTask([goal('g')], tasks, new Set())).toBeNull();
  });
});
