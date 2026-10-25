/**
 * データベースのスキーマ。
 *
 * 配列の i 番目が `user_version` を i から i+1 に上げる SQL。
 * 一度リリースした要素は書き換えず、変更は新しい要素として末尾に足す。
 *
 * 会話の本文は各プロバイダーの保存先に残るため、ここではセッション ID だけを持つ。
 * 途中経過（progress_events）には AI の発言も含め、タスクの詳細と相談の表示に使う。
 * 承認の待ちは Bridge のプロセスと一緒に消えるため、保存しない。
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    read_only_concurrency INTEGER NOT NULL DEFAULT 2,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_summary TEXT,
    plan_error TEXT,
    -- 計画を作ったセッション。指示を足して作り直すときに続きから使う
    plan_session_id TEXT,
    provider_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX goals_project ON goals(project_id, created_at);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT,
    latest TEXT,
    result TEXT,
    needs_game_restart INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX tasks_goal ON tasks(goal_id, number);

  CREATE TABLE task_deps (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on)
  );

  -- まだ AI に渡していない、タスクへの追加の指示
  CREATE TABLE pending_instructions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE consults (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX consults_project ON consults(project_id, updated_at);

  -- 途中経過。seq は Mod への再送にも使う連番
  CREATE TABLE progress_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX progress_events_owner ON progress_events(owner_type, owner_id, seq);

  -- Bridge 全体の設定。値は JSON
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 目標・相談ごとのモデルと思考量（null は設定の既定）
  `
  ALTER TABLE goals ADD COLUMN model TEXT;
  ALTER TABLE goals ADD COLUMN effort TEXT;
  ALTER TABLE consults ADD COLUMN model TEXT;
  ALTER TABLE consults ADD COLUMN effort TEXT;
  `,
];
