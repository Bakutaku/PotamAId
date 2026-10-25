/**
 * 承認の待ちの管理（仕様書5章「承認」）。
 *
 * AI が許可・回答・入力を求めると {@link request} で待ちを登録し、
 * 画面（将来はゲーム内も）からの回答で解決する。どちらから回答しても、最初の回答だけが使われる。
 * 待ちは Bridge のプロセスと一緒に消えるため、保存しない。
 */
import type {
  Approval,
  ApprovalResponse,
  ProgressOwner,
} from '../shared/domain';

interface PendingApproval {
  approval: Approval;
  resolve(response: ApprovalResponse): void;
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();

  /** 待ちを登録し、回答を待つ */
  request(approval: Approval): Promise<ApprovalResponse> {
    return new Promise((resolve) => {
      this.pending.set(approval.id, { approval, resolve });
    });
  }

  /** 回答する。すでに回答済み・取り消し済みなら false */
  respond(approvalId: string, response: ApprovalResponse): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return false;
    }
    this.pending.delete(approvalId);
    entry.resolve(response);
    return true;
  }

  /** タスク・相談・計画づくりの待ちを、すべて拒否として片付ける（中止したときなど） */
  cancelForOwner(owner: ProgressOwner): void {
    for (const [id, entry] of this.pending) {
      if (
        entry.approval.owner.type === owner.type &&
        entry.approval.owner.id === owner.id
      ) {
        this.respond(id, { decision: 'deny' });
      }
    }
  }

  /** すべての待ちを拒否として片付ける */
  cancelAll(): void {
    for (const id of this.pending.keys()) {
      this.respond(id, { decision: 'deny' });
    }
  }

  list(): Approval[] {
    return [...this.pending.values()]
      .map((entry) => entry.approval)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
