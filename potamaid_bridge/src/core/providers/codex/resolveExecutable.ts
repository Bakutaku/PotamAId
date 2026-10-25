/**
 * Codex の実行ファイルの場所を決める。
 *
 * 設定でパスを指定していればそれを使い、なければ PATH から `codex` を探す。
 * Windows で npm から導入した場合は `codex.cmd` になるため、
 * `.cmd`・`.bat` は cmd.exe を通して起動する（Node.js は直接起動できない）。
 *
 * 補足: Windows でコマンドの出力の日本語が文字化けするのは、Codex がコマンドを動かす
 * 疑似コンソールのコードページ（CP932）を UTF-8 として読むため。Codex を起動する前に
 * `chcp 65001` しても疑似コンソールには引き継がれないことを確かめたので、ここでは何もしない。
 */
import { statSync } from 'node:fs';
import path from 'node:path';

export interface LaunchCommand {
  /** spawn に渡す実行ファイル */
  file: string;
  /** spawn に渡す引数 */
  args: string[];
  /** Windows で引数をそのまま渡す（cmd.exe を通すとき） */
  windowsVerbatimArguments: boolean;
  /** 画面に出す、見つかった実行ファイルのパス */
  resolvedPath: string;
}

/** 実行ファイルが見つからないとき */
export class ExecutableNotFoundError extends Error {}

export function resolveLaunchCommand(
  configuredPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): LaunchCommand {
  const resolved = configuredPath.trim()
    ? resolveConfigured(configuredPath.trim())
    : findInPath('codex', env, platform);
  if (!resolved) {
    throw new ExecutableNotFoundError(
      configuredPath.trim()
        ? `Codex の実行ファイルが見つかりません: ${configuredPath}`
        : 'Codex の CLI が見つかりません。Codex の CLI を導入するか、設定で実行ファイルのパスを指定してください。',
    );
  }

  const ext = path.extname(resolved).toLowerCase();
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    const quoted = [resolved, ...args].map(quoteForCmd).join(' ');
    return {
      file: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${quoted}"`],
      windowsVerbatimArguments: true,
      resolvedPath: resolved,
    };
  }
  return {
    file: resolved,
    args,
    windowsVerbatimArguments: false,
    resolvedPath: resolved,
  };
}

function resolveConfigured(configured: string): string | null {
  return isFile(configured) ? path.resolve(configured) : null;
}

/** PATH の各ディレクトリから、実行できるファイルを探す */
function findInPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | null {
  const dirs = (env.PATH ?? env.Path ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const extensions =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** cmd.exe に渡す1つの引数を、空白や記号を含んでも崩れないように囲む */
function quoteForCmd(arg: string): string {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
