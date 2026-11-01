import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../../shared/domain';
import { normalizeProjectRoot } from './privateFiles';

export class ProjectMatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 明示指定は完全一致。未指定ならゲームの実在フォルダーを含む登録先が1つの場合だけ選ぶ。 */
export async function matchProject(
  projects: Project[],
  projectRoot: string,
  gameDirectory?: string,
): Promise<Project> {
  const explicit = projectRoot.trim();
  const normalized = await Promise.all(
    projects.map(async (project) => ({
      project,
      root: await normalizeProjectRoot(project.rootPath).catch(() => null),
    })),
  );

  if (explicit) {
    const root = await normalizeProjectRoot(explicit).catch(() => null);
    if (!root)
      throw new ProjectMatchError(
        'invalid_project_path',
        '対象modの指定フォルダーが見つかりません',
      );
    const match = normalized.find((candidate) => candidate.root === root);
    if (!match)
      throw new ProjectMatchError(
        'unknown_project',
        'Bridge に対象modのフォルダーが登録されていません',
      );
    return match.project;
  }

  const game = gameDirectory
    ? await normalizeProjectRoot(gameDirectory).catch(() => null)
    : null;
  if (!game)
    throw new ProjectMatchError(
      'invalid_game_directory',
      'ゲームの実行フォルダーを確認できないため、対象modを自動設定できません',
    );

  const matches: Project[] = [];
  for (const candidate of normalized) {
    if (!candidate.root || !isWithin(candidate.root, game)) continue;
    // リポジトリ内の .worktrees/ などから、外側の登録先へ誤接続しない。
    let current = game;
    while (current !== candidate.root && !(await hasGitBoundary(current)))
      current = path.dirname(current);
    if (current === candidate.root) matches.push(candidate.project);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    throw new ProjectMatchError(
      'ambiguous_project',
      'ゲームの実行フォルダーに対応する対象modが複数あります。bridge.projectRoot で接続先を指定してください',
    );
  throw new ProjectMatchError(
    'unknown_game_project',
    'ゲームの実行フォルダーに対応する対象modがありません。Bridge の登録先を確認するか、bridge.projectRoot で接続先を指定してください',
  );
}

function isWithin(root: string, directory: string): boolean {
  const relative = path.relative(root, directory);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function hasGitBoundary(directory: string): Promise<boolean> {
  try {
    await lstat(path.join(directory, '.git'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new ProjectMatchError(
      'project_access_error',
      'ゲームの実行フォルダーの所属を確認できません。フォルダーのアクセス権を確認してください',
    );
  }
}
