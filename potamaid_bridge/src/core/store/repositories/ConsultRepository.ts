import type {
  Consult,
  ConsultStatus,
  ProviderId,
} from '../../../shared/domain';
import type { Database } from '../Database';

interface ConsultRow {
  id: string;
  project_id: string;
  title: string;
  provider_id: string;
  model: string | null;
  effort: string | null;
  session_id: string | null;
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const toConsult = (row: ConsultRow): Consult => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  providerId: row.provider_id as ProviderId,
  model: row.model,
  effort: row.effort,
  status: row.status as ConsultStatus,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** 相談の保存と読み込み */
export class ConsultRepository {
  constructor(private readonly db: Database) {}

  /** すべての相談を、新しくやり取りした順に返す */
  list(): Consult[] {
    return this.db
      .all<ConsultRow>('SELECT * FROM consults ORDER BY updated_at DESC')
      .map(toConsult);
  }

  find(id: string): Consult | undefined {
    const row = this.db.get<ConsultRow>(
      'SELECT * FROM consults WHERE id = ?',
      id,
    );
    return row && toConsult(row);
  }

  get(id: string): Consult {
    const consult = this.find(id);
    if (!consult) {
      throw new Error('相談が見つかりません');
    }
    return consult;
  }

  insert(consult: Consult): void {
    this.db.run(
      'INSERT INTO consults (id, project_id, title, provider_id, model, effort, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      consult.id,
      consult.projectId,
      consult.title,
      consult.providerId,
      consult.model,
      consult.effort,
      consult.status,
      consult.error,
      consult.createdAt,
      consult.updatedAt,
    );
  }

  setStatus(
    id: string,
    status: ConsultStatus,
    error: string | null,
    updatedAt: number,
  ): void {
    this.db.run(
      'UPDATE consults SET status = ?, error = ?, updated_at = ? WHERE id = ?',
      status,
      error,
      updatedAt,
      id,
    );
  }

  getSessionId(id: string): string | null {
    return (
      this.db.get<{ session_id: string | null }>(
        'SELECT session_id FROM consults WHERE id = ?',
        id,
      )?.session_id ?? null
    );
  }

  setSessionId(id: string, sessionId: string): void {
    this.db.run(
      'UPDATE consults SET session_id = ? WHERE id = ?',
      sessionId,
      id,
    );
  }

  /** 指定した状態の相談を、まとめて別の状態にする（起動時の後片付け） */
  resetStatuses(
    from: ConsultStatus[],
    to: ConsultStatus,
    updatedAt: number,
  ): string[] {
    const marks = from.map(() => '?').join(', ');
    const ids = this.db
      .all<{
        id: string;
      }>(`SELECT id FROM consults WHERE status IN (${marks})`, ...from)
      .map((row) => row.id);
    for (const id of ids) {
      this.setStatus(id, to, null, updatedAt);
    }
    return ids;
  }
}
