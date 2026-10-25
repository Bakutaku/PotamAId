import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BridgeStore } from './BridgeStore';
import { MIGRATIONS } from './migrations';

describe('migrations', () => {
  it('タスクの確認待ちをなくし、目標の確認中・完了に移す', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'potamaid-migration-'));
    const databasePath = path.join(dir, 'bridge.sqlite');
    try {
      // 目標の単位の確認を入れる前（user_version 2）のデータを作る
      const old = new DatabaseSync(databasePath);
      MIGRATIONS.slice(0, 2).forEach((sql) => old.exec(sql));
      old.exec('PRAGMA user_version = 2');
      old.exec(`
        INSERT INTO projects (id, name, root_path, created_at) VALUES ('p', 'p', '${dir.replaceAll("'", "''")}', 0);
        INSERT INTO goals (id, project_id, title, text, status, provider_id, created_at) VALUES
          ('checked', 'p', '', '', 'active', 'codex', 0),
          ('reviewing', 'p', '', '', 'active', 'codex', 1),
          ('running', 'p', '', '', 'active', 'codex', 2);
        INSERT INTO tasks (id, goal_id, number, title, description, status) VALUES
          ('c1', 'checked', 1, '', '', 'done'),
          ('r1', 'reviewing', 1, '', '', 'done'),
          ('r2', 'reviewing', 2, '', '', 'review'),
          ('u1', 'running', 1, '', '', 'review'),
          ('u2', 'running', 2, '', '', 'todo');
      `);
      old.close();

      const store = new BridgeStore(databasePath);
      expect(store.tasks.list().every((task) => task.paused === false)).toBe(
        true,
      );
      const statusOf = new Map(store.goals.list().map((g) => [g.id, g.status]));
      expect(Object.fromEntries(statusOf)).toEqual({
        checked: 'done',
        reviewing: 'review',
        running: 'active',
      });
      expect(store.tasks.list().map((t) => [t.id, t.status, t.kind])).toEqual([
        ['c1', 'done', 'edit'],
        ['r1', 'done', 'edit'],
        ['r2', 'done', 'edit'],
        ['u1', 'done', 'edit'],
        ['u2', 'todo', 'edit'],
      ]);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
