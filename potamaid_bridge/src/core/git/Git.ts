/**
 * git のコマンドの実行（目標の worktree の作成・タスクごとのコミット・反映に使う）。
 *
 * 利用者の PATH の `git` を子プロセスで実行する。出力は UTF-8 で読み、
 * 日本語のファイル名がエスケープされないように core.quotePath を切る。
 */
import { execFile } from 'node:child_process';

/** 1回のコマンドを待つ時間 */
const GIT_TIMEOUT_MS = 120_000;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    const detail = (result.stderr || result.stdout).trim();
    super(`git ${args[0] ?? ''} に失敗しました${detail ? `: ${detail}` : ''}`);
  }
}

/** git を実行する。終了コードが 0 でなくても例外にせず、結果を返す */
export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        // 認証やエディターの入力を待って止まらないようにする
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? new Error(
                  'git が見つかりません。git をインストールしてください',
                )
              : error,
          );
          return;
        }
        resolve({
          code: typeof error?.code === 'number' ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

/** git を実行し、失敗したら例外にする。標準出力の前後の空白を除いて返す */
export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.code !== 0) {
    throw new GitError(args, result);
  }
  return result.stdout.trim();
}
