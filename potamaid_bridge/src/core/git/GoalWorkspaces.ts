/**
 * 目標ごとの git worktree の操作（仕様書3章「worktree での並行実行」）。
 *
 * - 計画の承認で、目標のブランチ（potamaid/goal-<id>）と worktree を作る。
 *   分岐元は、ゲームを起動するディレクトリでいま使っているブランチ
 * - タスクが終わるたびに、Bridge が目標のブランチにコミットする（AI にはコミットさせない）
 * - 反映の前に分岐元のブランチを取り込み、ゲームを起動するディレクトリには
 *   コミットしない変更として置く（`git merge --squash` 相当。2026-10-25 決定）
 * - 完了にした目標の worktree は消し、ブランチは undo のために残す（2026-10-25 決定）
 *
 * 目標・タスクの状態は扱わず、git の操作だけを行う。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { GoalWorktree } from '../store/repositories/GoalRepository';
import { git, GitError, runGit } from './Git';

/** git の利用者の名前とメールアドレスがないときに、Bridge のコミットに使う */
const FALLBACK_IDENTITY = [
  '-c',
  'user.name=PotamAId Bridge',
  '-c',
  'user.email=potamaid-bridge@localhost',
];

/** ゲームを起動するディレクトリに反映できるかの確認の結果 */
export type RootCheck =
  | { ok: true }
  /** 反映できない（理由を利用者に知らせる） */
  | { ok: false; reason: string }
  /** 分岐元に新しいコミットがあり、もう一度取り込む必要がある */
  | { ok: false; stale: true };

export class GoalWorkspaces {
  /** @param baseDir worktree を置くディレクトリ（Bridge のユーザーデータの worktrees） */
  constructor(private readonly baseDir: string) {}

  /**
   * 目標のブランチと worktree を作る。
   * 対象modが git のリポジトリでない・コミットがない・ブランチにいないときは、理由を書いた例外にする
   */
  async create(
    projectId: string,
    rootPath: string,
    goalId: string,
  ): Promise<GoalWorktree> {
    const top = await this.topLevel(rootPath);
    if ((await runGit(top, ['rev-parse', '--verify', '-q', 'HEAD'])).code) {
      throw new Error(
        '対象modのリポジトリにコミットがありません。最初のコミットをしてから承認してください',
      );
    }
    const baseBranch = (
      await runGit(top, ['symbolic-ref', '--short', '-q', 'HEAD'])
    ).stdout.trim();
    if (!baseBranch) {
      throw new Error(
        'ゲームを起動するディレクトリがブランチにいません（detached HEAD）。ブランチに切り替えてから承認してください',
      );
    }
    const branch = await this.freeBranchName(
      top,
      `potamaid/goal-${goalId.slice(0, 8)}`,
    );
    const worktreePath = path.join(this.baseDir, projectId, goalId);
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    await git(top, ['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
    // 対象modのフォルダーがリポジトリの中のフォルダーなら、worktree でも同じ場所を作業ディレクトリにする
    const relative = path.relative(path.resolve(top), path.resolve(rootPath));
    return {
      branch,
      baseBranch,
      worktreePath,
      workDir: path.join(worktreePath, relative),
    };
  }

  /**
   * worktree の変更を、目標のブランチにコミットする。変更がなければコミットしない。
   * 競合を解いている途中（MERGE_HEAD がある）なら、取り込みのコミットを作る。
   * 利用者の commit フックは、利用者のコミットのためのものなので実行しない
   * @returns コミットしたか
   */
  async commit(worktreePath: string, message: string): Promise<boolean> {
    await git(worktreePath, ['add', '-A']);
    const merging =
      (
        await runGit(worktreePath, [
          'rev-parse',
          '-q',
          '--verify',
          'MERGE_HEAD',
        ])
      ).code === 0;
    const staged =
      (await runGit(worktreePath, ['diff', '--cached', '--quiet'])).code !== 0;
    if (!merging && !staged) {
      return false;
    }
    await git(worktreePath, [
      ...(await this.identity(worktreePath)),
      'commit',
      '--no-verify',
      '-m',
      message,
    ]);
    return true;
  }

  /**
   * 分岐元のブランチの新しい変更を、目標のブランチに取り込む。
   * @returns 競合したファイル（競合がなければ空）。競合したら、取り込みの途中のまま残す
   */
  async mergeBase(worktree: GoalWorktree): Promise<string[]> {
    const dir = requirePath(worktree.worktreePath);
    const base = requirePath(worktree.baseBranch);
    const result = await runGit(dir, [
      ...(await this.identity(dir)),
      'merge',
      '--no-edit',
      '--no-verify',
      base,
    ]);
    if (result.code === 0) {
      return [];
    }
    const conflicts = (
      await git(dir, ['diff', '--name-only', '--diff-filter=U'])
    )
      .split('\n')
      .filter(Boolean);
    if (conflicts.length === 0) {
      throw new GitError(['merge', base], result);
    }
    return conflicts;
  }

  /** ゲームを起動するディレクトリに、目標の変更を置けるかを確かめる */
  async checkRoot(
    rootPath: string,
    worktree: GoalWorktree,
  ): Promise<RootCheck> {
    const top = await this.topLevel(rootPath);
    const current = (
      await runGit(top, ['symbolic-ref', '--short', '-q', 'HEAD'])
    ).stdout.trim();
    if (current !== worktree.baseBranch) {
      return {
        ok: false,
        reason: `ゲームを起動するディレクトリのブランチが ${current || '（ブランチなし）'} です。${worktree.baseBranch} に切り替えてから「反映する」を押してください`,
      };
    }
    const status = await git(top, [
      'status',
      '--porcelain',
      '--untracked-files=no',
    ]);
    if (status) {
      return {
        ok: false,
        reason:
          'ゲームを起動するディレクトリにコミットしていない変更があります。コミットするか退避してから「反映する」を押してください',
      };
    }
    const contained = await runGit(top, [
      'merge-base',
      '--is-ancestor',
      'HEAD',
      requirePath(worktree.branch),
    ]);
    return contained.code === 0 ? { ok: true } : { ok: false, stale: true };
  }

  /**
   * 目標の変更を、ゲームを起動するディレクトリにコミットしない変更として置く。
   * 先に {@link checkRoot} で、分岐元を取り込み済みで変更がないことを確かめておく
   */
  async squashInto(rootPath: string, worktree: GoalWorktree): Promise<void> {
    const top = await this.topLevel(rootPath);
    await git(top, ['merge', '--squash', requirePath(worktree.branch)]);
  }

  /** worktree を消す（ブランチは残す） */
  async remove(rootPath: string, worktreePath: string): Promise<void> {
    const top = await this.topLevel(rootPath);
    const result = await runGit(top, [
      'worktree',
      'remove',
      '--force',
      worktreePath,
    ]);
    if (result.code !== 0) {
      // すでにフォルダーがないときは、git の記録だけを消す
      await git(top, ['worktree', 'prune']);
    }
  }

  /** リポジトリのルート。git のリポジトリでなければ例外 */
  private async topLevel(rootPath: string): Promise<string> {
    const result = await runGit(rootPath, ['rev-parse', '--show-toplevel']);
    if (result.code !== 0) {
      throw new Error(
        '対象modが git のリポジトリではありません。git init と最初のコミットをしてから承認してください',
      );
    }
    return path.resolve(result.stdout.trim());
  }

  /** 使われていないブランチの名前（同じ名前があれば番号を付ける） */
  private async freeBranchName(top: string, name: string): Promise<string> {
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? name : `${name}-${i}`;
      const exists = await runGit(top, [
        'show-ref',
        '--verify',
        '-q',
        `refs/heads/${candidate}`,
      ]);
      if (exists.code !== 0) {
        return candidate;
      }
    }
  }

  /** コミットに使う名前とメールアドレス。git の設定になければ Bridge のものを使う */
  private async identity(cwd: string): Promise<string[]> {
    const email = await runGit(cwd, ['config', 'user.email']);
    return email.code === 0 && email.stdout.trim() ? [] : FALLBACK_IDENTITY;
  }
}

function requirePath(value: string | null): string {
  if (!value) {
    throw new Error('目標の worktree の情報がありません');
  }
  return value;
}
