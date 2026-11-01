import type { Goal, GoalStatus, ProviderId } from '../../../shared/domain';
import type { Database } from '../Database';

interface GoalRow {
  id: string;
  project_id: string;
  title: string;
  text: string;
  status: string;
  plan_summary: string | null;
  plan_error: string | null;
  plan_session_id: string | null;
  provider_id: string;
  profile_id: string | null;
  model: string | null;
  effort: string | null;
  branch: string | null;
  base_branch: string | null;
  worktree_path: string | null;
  work_dir: string | null;
  wait_reason: string | null;
  round_started_at: number | null;
  created_at: number;
}

/** 目標の worktree の情報 */
export type GoalWorktree = Pick<
  Goal,
  'branch' | 'baseBranch' | 'worktreePath' | 'workDir'
>;

const toGoal = (row: GoalRow): Goal => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  text: row.text,
  status: row.status as GoalStatus,
  planSummary: row.plan_summary,
  planError: row.plan_error,
  providerId: row.provider_id as ProviderId,
  profileId: row.profile_id,
  model: row.model,
  effort: row.effort,
  branch: row.branch,
  baseBranch: row.base_branch,
  worktreePath: row.worktree_path,
  workDir: row.work_dir,
  waitReason: row.wait_reason,
  roundStartedAt: row.round_started_at,
  createdAt: row.created_at,
});

/** 目標の保存と読み込み */
export class GoalRepository {
  constructor(private readonly db: Database) {}

  /** すべての目標を作成順に返す */
  list(): Goal[] {
    return this.db
      .all<GoalRow>('SELECT * FROM goals ORDER BY created_at')
      .map(toGoal);
  }

  find(id: string): Goal | undefined {
    const row = this.db.get<GoalRow>('SELECT * FROM goals WHERE id = ?', id);
    return row && toGoal(row);
  }

  /** 見つからなければ例外（画面からの操作で、消えた目標を指定された場合など） */
  get(id: string): Goal {
    const goal = this.find(id);
    if (!goal) {
      throw new Error('目標が見つかりません');
    }
    return goal;
  }

  insert(goal: Goal): void {
    this.db.run(
      'INSERT INTO goals (id, project_id, title, text, status, plan_summary, plan_error, provider_id, profile_id, model, effort, round_started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      goal.id,
      goal.projectId,
      goal.title,
      goal.text,
      goal.status,
      goal.planSummary,
      goal.planError,
      goal.providerId,
      goal.profileId,
      goal.model,
      goal.effort,
      goal.roundStartedAt,
      goal.createdAt,
    );
  }

  setStatus(id: string, status: GoalStatus, planError: string | null = null) {
    this.db.run(
      'UPDATE goals SET status = ?, plan_error = ? WHERE id = ?',
      status,
      planError,
      id,
    );
  }

  /** 目標の worktree の情報を保存する（消したときは worktreePath・workDir を null にする） */
  setWorktree(id: string, worktree: GoalWorktree): void {
    this.db.run(
      'UPDATE goals SET branch = ?, base_branch = ?, worktree_path = ?, work_dir = ? WHERE id = ?',
      worktree.branch,
      worktree.baseBranch,
      worktree.worktreePath,
      worktree.workDir,
      id,
    );
  }

  setWaitReason(id: string, reason: string | null): void {
    this.db.run('UPDATE goals SET wait_reason = ? WHERE id = ?', reason, id);
  }

  /** いまの作業の区切りを始めた時刻を保存する */
  setRoundStartedAt(id: string, time: number): void {
    this.db.run('UPDATE goals SET round_started_at = ? WHERE id = ?', time, id);
  }

  /** 計画ができたときに、題名と要約を保存する */
  setPlan(id: string, title: string, summary: string): void {
    this.db.run(
      'UPDATE goals SET title = ?, plan_summary = ? WHERE id = ?',
      title,
      summary,
      id,
    );
  }

  getPlanSessionId(id: string): string | null {
    return (
      this.db.get<{ plan_session_id: string | null }>(
        'SELECT plan_session_id FROM goals WHERE id = ?',
        id,
      )?.plan_session_id ?? null
    );
  }

  setPlanSessionId(id: string, sessionId: string | null): void {
    this.db.run(
      'UPDATE goals SET plan_session_id = ? WHERE id = ?',
      sessionId,
      id,
    );
  }
}
