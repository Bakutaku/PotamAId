/**
 * テスト用の git のリポジトリ（テストからだけ使う）。
 * 利用者の git の設定に左右されないよう、名前・メールアドレス・改行の変換・フックをリポジトリで決める。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface TestRepo {
  /** リポジトリ（ゲームを起動するディレクトリに当たる） */
  dir: string;
  /** 目標の worktree を置くディレクトリ */
  worktreesDir: string;
  /** リポジトリで git を実行し、標準出力を返す */
  git(...args: string[]): string;
  cleanup(): void;
}

export function createTestRepo(): TestRepo {
  const dir = mkdtempSync(path.join(tmpdir(), 'potamaid-repo-'));
  const worktreesDir = mkdtempSync(path.join(tmpdir(), 'potamaid-worktrees-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.hooksPath', path.join(dir, '.no-hooks'));
  writeFileSync(path.join(dir, 'README.md'), 'test\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return {
    dir,
    worktreesDir,
    git,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(worktreesDir, { recursive: true, force: true });
    },
  };
}
