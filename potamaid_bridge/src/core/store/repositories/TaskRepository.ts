import type { Task, TaskKind, TaskStatus } from '../../../shared/domain';
import type { Database } from '../Database';

interface TaskRow {
  id: string;
  goal_id: string;
  number: number;
  title: string;
  description: string;
  kind: string;
  status: string;
  paused: number;
  session_id: string | null;
  latest: string | null;
  result: string | null;
  needs_game_restart: number;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  pending_count: number;
}

/** タスクの行に、追加の指示の数を付けて読む SQL */
const SELECT_TASKS = `
  SELECT t.*, (
    SELECT COUNT(*) FROM pending_instructions p WHERE p.task_id = t.id
  ) AS pending_count
  FROM tasks t`;

/** 保存するタスクの内容（依存関係と指示の数は別に扱う） */
export type TaskRecord = Omit<Task, 'dependsOn' | 'pendingInstructions'>;

/** 部分的に更新できる列 */
export type TaskUpdate = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'kind'
    | 'status'
    | 'paused'
    | 'latest'
    | 'result'
    | 'needsGameRestart'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
  > & { sessionId: string | null }
>;

/** TaskUpdate のプロパティ名 → 列名 */
const COLUMNS: Record<keyof TaskUpdate, string> = {
  title: 'title',
  description: 'description',
  kind: 'kind',
  status: 'status',
  paused: 'paused',
  latest: 'latest',
  result: 'result',
  needsGameRestart: 'needs_game_restart',
  error: 'error',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  sessionId: 'session_id',
};

/** タスク・依存関係・追加の指示の保存と読み込み */
export class TaskRepository {
  constructor(private readonly db: Database) {}

  /** すべてのタスクを、目標ごとに番号順で返す */
  list(): Task[] {
    return this.withDeps(
      this.db.all<TaskRow>(`${SELECT_TASKS} ORDER BY t.goal_id, t.number`),
    );
  }

  listByGoal(goalId: string): Task[] {
    return this.withDeps(
      this.db.all<TaskRow>(
        `${SELECT_TASKS} WHERE t.goal_id = ? ORDER BY t.number`,
        goalId,
      ),
    );
  }

  find(id: string): Task | undefined {
    const row = this.db.get<TaskRow>(`${SELECT_TASKS} WHERE t.id = ?`, id);
    return row && this.withDeps([row])[0];
  }

  /** 見つからなければ例外 */
  get(id: string): Task {
    const task = this.find(id);
    if (!task) {
      throw new Error('タスクが見つかりません');
    }
    return task;
  }

  /** 指定した状態のタスクを返す */
  listByStatus(statuses: TaskStatus[]): Task[] {
    const marks = statuses.map(() => '?').join(', ');
    return this.withDeps(
      this.db.all<TaskRow>(
        `${SELECT_TASKS} WHERE t.status IN (${marks}) ORDER BY t.number`,
        ...statuses,
      ),
    );
  }

  getSessionId(id: string): string | null {
    return (
      this.db.get<{ session_id: string | null }>(
        'SELECT session_id FROM tasks WHERE id = ?',
        id,
      )?.session_id ?? null
    );
  }

  insert(task: TaskRecord, dependsOn: string[]): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO tasks (id, goal_id, number, title, description, kind, status, paused, latest, result, needs_game_restart, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        task.goalId,
        task.number,
        task.title,
        task.description,
        task.kind,
        task.status,
        task.paused ? 1 : 0,
        task.latest,
        task.result,
        task.needsGameRestart ? 1 : 0,
        task.error,
        task.startedAt,
        task.finishedAt,
      );
      this.setDependencies(task.id, dependsOn);
    });
  }

  update(id: string, update: TaskUpdate): void {
    const entries = Object.entries(update) as [
      keyof TaskUpdate,
      TaskUpdate[keyof TaskUpdate],
    ][];
    if (entries.length === 0) {
      return;
    }
    const sets = entries.map(([key]) => `${COLUMNS[key]} = ?`).join(', ');
    const values = entries.map(([, value]) =>
      typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null),
    );
    this.db.run(`UPDATE tasks SET ${sets} WHERE id = ?`, ...values, id);
  }

  setDependencies(taskId: string, dependsOn: string[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM task_deps WHERE task_id = ?', taskId);
      for (const dep of new Set(dependsOn)) {
        this.db.run(
          'INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)',
          taskId,
          dep,
        );
      }
    });
  }

  delete(id: string): void {
    this.db.run('DELETE FROM tasks WHERE id = ?', id);
  }

  deleteByGoal(goalId: string): void {
    this.db.run('DELETE FROM tasks WHERE goal_id = ?', goalId);
  }

  /** 目標のタスクの番号を 1 から振り直す（削除のあとなど） */
  renumber(goalId: string): void {
    this.db.transaction(() => {
      const ids = this.db.all<{ id: string }>(
        'SELECT id FROM tasks WHERE goal_id = ? ORDER BY number',
        goalId,
      );
      ids.forEach(({ id }, index) => {
        this.db.run('UPDATE tasks SET number = ? WHERE id = ?', index + 1, id);
      });
    });
  }

  addInstruction(taskId: string, text: string, createdAt: number): void {
    this.db.run(
      'INSERT INTO pending_instructions (task_id, text, created_at) VALUES (?, ?, ?)',
      taskId,
      text,
      createdAt,
    );
  }

  /** 送信する指示のスナップショット。受け付けが確定するまでは DB に残す */
  peekInstructions(taskId: string): { id: number; text: string }[] {
    return this.db.all<{ id: number; text: string }>(
      'SELECT id, text FROM pending_instructions WHERE task_id = ? ORDER BY id',
      taskId,
    );
  }

  /** 受け付け済みの分だけ消す。送信中に追加された指示には触れない */
  acknowledgeInstructions(taskId: string, ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.db.run(
          'DELETE FROM pending_instructions WHERE task_id = ? AND id = ?',
          taskId,
          id,
        );
      }
    });
  }

  private withDeps(rows: TaskRow[]): Task[] {
    if (rows.length === 0) {
      return [];
    }
    const deps = new Map<string, string[]>();
    for (const row of this.db.all<{ task_id: string; depends_on: string }>(
      'SELECT task_id, depends_on FROM task_deps',
    )) {
      const list = deps.get(row.task_id) ?? [];
      list.push(row.depends_on);
      deps.set(row.task_id, list);
    }
    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      number: row.number,
      title: row.title,
      description: row.description,
      kind: row.kind as TaskKind,
      status: row.status as TaskStatus,
      paused: row.paused === 1,
      latest: row.latest,
      result: row.result,
      needsGameRestart: row.needs_game_restart === 1,
      error: row.error,
      pendingInstructions: row.pending_count,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      dependsOn: deps.get(row.id) ?? [],
    }));
  }
}
