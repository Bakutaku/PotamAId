/**
 * SQLite の接続（Electron に含まれる Node.js の組み込みの `node:sqlite` を使う）。
 *
 * - WAL モードにして、Bridge が異常終了してもデータが壊れにくくする
 * - スキーマは `PRAGMA user_version` で管理し、起動時に足りない分だけ適用する
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export type SqlParam = SQLInputValue;
export type Row = Record<string, SqlParam>;

export class Database {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  /** @param path データベースのファイルのパス。`:memory:` ならメモリ上に作る（テスト用） */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  /** 行を返さない SQL を実行し、変更した行数を返す */
  run(sql: string, ...params: SqlParam[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  /** 最初の1行を返す。なければ undefined */
  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** INSERT を実行し、自動採番された ID を返す */
  insert(sql: string, ...params: SqlParam[]): number {
    return Number(this.db.prepare(sql).run(...params).lastInsertRowid);
  }

  /**
   * 処理をトランザクションの中で実行する。例外が出たら取り消す。
   * 入れ子で呼んだ場合は、いちばん外側のトランザクションにまとめる。
   */
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      return fn();
    }
    this.db.exec('BEGIN');
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const row = this.get<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    MIGRATIONS.slice(current).forEach((sql, index) => {
      this.transaction(() => {
        this.db.exec(sql);
        // PRAGMA にはプレースホルダーを使えないため、数値を直接埋め込む
        this.db.exec(`PRAGMA user_version = ${current + index + 1}`);
      });
    });
  }
}
