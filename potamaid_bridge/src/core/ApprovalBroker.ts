/**
 * 承認の待ちの管理（仕様書5章「承認」）。
 *
 * AI が許可・回答・入力を求めると {@link request} で待ちを登録し、
 * 画面やゲーム内からの回答で解決する。どちらから回答しても、最初の回答だけが使われる。
 * 待ちは Bridge のプロセスと一緒に消えるため、保存しない。
 */
import type {
  Approval,
  ApprovalDecision,
  ApprovalResponse,
  ProgressOwner,
} from '../shared/domain';

/** 承認を解決したもの。app は Bridge の画面、game はゲーム内、cancel は中止による取り消し */
export type ApprovalResolver = 'app' | 'game' | 'cancel';

/** 解決した承認の記録。回答の内容（秘密を含み得る）は持たない */
export interface ApprovalResolution {
  projectId: string;
  approvalId: string;
  by: ApprovalResolver;
  decision: ApprovalDecision;
}

interface PendingApproval {
  approval: Approval;
  resolve(response: ApprovalResponse): void;
}

/** 「回答済み」を知らせるために覚えておく、解決済みの承認の数 */
const RESOLVED_HISTORY = 64;

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly resolved = new Map<string, ApprovalResolution>();

  constructor(
    private readonly onResolved: (
      resolution: ApprovalResolution,
    ) => void = () => undefined,
  ) {}

  /** 待ちを登録し、回答を待つ */
  request(approval: Approval): Promise<ApprovalResponse> {
    return new Promise((resolve) => {
      this.pending.set(approval.id, { approval, resolve });
    });
  }

  /** 回答する。すでに回答済み・取り消し済みなら false */
  respond(
    approvalId: string,
    response: ApprovalResponse,
    by: ApprovalResolver = 'app',
  ): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return false;
    }
    this.pending.delete(approvalId);
    const resolution: ApprovalResolution = {
      projectId: entry.approval.projectId,
      approvalId,
      by,
      decision: response.decision,
    };
    this.resolved.set(approvalId, resolution);
    if (this.resolved.size > RESOLVED_HISTORY) {
      this.resolved.delete(this.resolved.keys().next().value as string);
    }
    entry.resolve(response);
    this.onResolved(resolution);
    return true;
  }

  /** 解決済みの承認が、だれに解決されたか。覚えていなければ undefined */
  resolution(approvalId: string): ApprovalResolution | undefined {
    return this.resolved.get(approvalId);
  }

  /** 対象modの解決済みの承認を、ID（先頭8文字以上）で探す。ただ1件に決まらなければ undefined */
  findResolved(
    projectId: string,
    prefix: string,
  ): ApprovalResolution | undefined {
    const matches = [...this.resolved.values()].filter(
      (r) => r.projectId === projectId && r.approvalId.startsWith(prefix),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** タスク・相談・計画づくりの待ちを、すべて拒否として片付ける（中止したときなど） */
  cancelForOwner(owner: ProgressOwner): void {
    for (const [id, entry] of this.pending) {
      if (
        entry.approval.owner.type === owner.type &&
        entry.approval.owner.id === owner.id
      ) {
        this.respond(id, { decision: 'deny' }, 'cancel');
      }
    }
  }

  /** すべての待ちを拒否として片付ける */
  cancelAll(): void {
    for (const id of this.pending.keys()) {
      this.respond(id, { decision: 'deny' }, 'cancel');
    }
  }

  list(): Approval[] {
    return [...this.pending.values()]
      .map((entry) => entry.approval)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
