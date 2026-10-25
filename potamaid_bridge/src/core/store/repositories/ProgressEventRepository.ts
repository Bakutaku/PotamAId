import type {
  ProgressEvent,
  ProgressKind,
  ProgressOwner,
  ProgressOwnerType,
} from '../../../shared/domain';
import type { Database } from '../Database';

interface ProgressEventRow {
  seq: number;
  owner_type: string;
  owner_id: string;
  kind: string;
  text: string;
  detail: string | null;
  created_at: number;
}

const toEvent = (row: ProgressEventRow): ProgressEvent => ({
  seq: row.seq,
  ownerType: row.owner_type as ProgressOwnerType,
  ownerId: row.owner_id,
  kind: row.kind as ProgressKind,
  text: row.text,
  detail: row.detail,
  createdAt: row.created_at,
});

/** 途中経過の保存と読み込み。保存期間は未決定のため、今は消さない */
export class ProgressEventRepository {
  constructor(private readonly db: Database) {}

  append(event: Omit<ProgressEvent, 'seq'>): ProgressEvent {
    const seq = this.db.insert(
      'INSERT INTO progress_events (owner_type, owner_id, kind, text, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      event.ownerType,
      event.ownerId,
      event.kind,
      event.text,
      event.detail,
      event.createdAt,
    );
    return { ...event, seq };
  }

  listByOwner(owner: ProgressOwner): ProgressEvent[] {
    return this.db
      .all<ProgressEventRow>(
        'SELECT * FROM progress_events WHERE owner_type = ? AND owner_id = ? ORDER BY seq',
        owner.type,
        owner.id,
      )
      .map(toEvent);
  }
}
