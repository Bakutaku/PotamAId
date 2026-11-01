import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../shared/domain';
import { matchProject } from './matchProject';

describe('起動フォルダーからの対象modの自動設定', () => {
  let directory: string;
  const project = (rootPath: string, id = 'project'): Project => ({
    id,
    rootPath,
    name: id,
    readOnlyConcurrency: 2,
    editConcurrency: 1,
    weightProfiles: {},
    createdAt: 0,
  });
  const folder = async (...parts: string[]) => {
    const result = path.join(directory, ...parts);
    await mkdir(result, { recursive: true });
    return result;
  };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'potamaid-match-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('登録済みの Mod プロジェクトの run フォルダーなら自動で紐付ける', async () => {
    const game = await folder('mod', 'run');
    expect(
      (await matchProject([project(path.dirname(game))], '', game)).id,
    ).toBe('project');
  });
  it('モノレポのルートを登録した場合も、その中のゲームを自動で紐付ける', async () => {
    const game = await folder('mod', 'run');
    expect((await matchProject([project(directory)], '', game)).id).toBe(
      'project',
    );
  });
  it('複数の対象modのうち、ゲームを含むものだけを選ぶ', async () => {
    const game = await folder('first', 'run');
    const second = await folder('second');
    expect(
      (
        await matchProject(
          [project(second, 'second'), project(path.dirname(game), 'first')],
          '',
          game,
        )
      ).id,
    ).toBe('first');
  });
  it('ルートとその子が両方登録されている場合は、近さで決めず候補の競合を伝える', async () => {
    const game = await folder('mod', 'run');
    await expect(
      matchProject(
        [project(directory), project(path.dirname(game), 'mod')],
        '',
        game,
      ),
    ).rejects.toMatchObject({ code: 'ambiguous_project' });
  });
  it('候補が複数でも、明示指定した登録先は優先する', async () => {
    const game = await folder('mod', 'run');
    expect(
      (
        await matchProject(
          [project(directory), project(path.dirname(game), 'mod')],
          path.dirname(game),
          game,
        )
      ).id,
    ).toBe('mod');
  });
  it('明示指定した未登録フォルダーがある場合は、自動判定で置き換えない', async () => {
    const game = await folder('mod', 'run');
    await expect(
      matchProject([project(directory)], path.dirname(game), game),
    ).rejects.toMatchObject({ code: 'unknown_project' });
  });
  it('似た接頭辞の別フォルダーや、無関係な登録先に紐付けない', async () => {
    const root = await folder('mod');
    const game = await folder('mod-other', 'run');
    await expect(matchProject([project(root)], '', game)).rejects.toMatchObject(
      { code: 'unknown_game_project' },
    );
  });
  it('リポジトリ内に置かれた worktree から、外側のプロジェクトへ紐付けない', async () => {
    const game = await folder('.worktrees', 'goal', 'run');
    await writeFile(path.join(path.dirname(game), '.git'), 'gitdir: /unused');
    await expect(
      matchProject([project(directory)], '', game),
    ).rejects.toMatchObject({ code: 'unknown_game_project' });
  });
  it('内側の worktree 自体が登録済みなら、その登録先を使う', async () => {
    const game = await folder('.worktrees', 'goal', 'run');
    await writeFile(path.join(path.dirname(game), '.git'), 'gitdir: /unused');
    expect(
      (
        await matchProject(
          [project(directory), project(path.dirname(game), 'worktree')],
          '',
          game,
        )
      ).id,
    ).toBe('worktree');
  });
  it('入れ子の別リポジトリも境界として扱う', async () => {
    const game = await folder('nested', 'run');
    await folder('nested', '.git');
    await expect(
      matchProject([project(directory)], '', game),
    ).rejects.toMatchObject({ code: 'unknown_game_project' });
  });
  it('シンボリックリンクやジャンクションの先の実在フォルダーで照合する', async () => {
    const root = await folder('mod');
    const game = await folder('mod', 'run');
    const alias = path.join(directory, 'alias');
    await symlink(
      root,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect((await matchProject([project(alias)], '', game)).id).toBe('project');
  });
  it('ゲームのフォルダーがない場合や相対パスの場合は自動設定しない', async () => {
    for (const game of [
      undefined,
      '',
      'run',
      path.join(directory, 'missing'),
    ]) {
      await expect(
        matchProject([project(directory)], '', game),
      ).rejects.toMatchObject({ code: 'invalid_game_directory' });
    }
  });
  it('既存クライアントの明示指定は、ゲームのフォルダーを送らなくても使える', async () => {
    expect((await matchProject([project(directory)], directory)).id).toBe(
      'project',
    );
  });
  it('Windows の大文字・小文字と末尾の区切りを自動判定でも正規化する', async () => {
    const game = await folder('mod', 'run');
    const root = path.dirname(game);
    expect(
      (
        await matchProject(
          [project(root + path.sep)],
          '',
          process.platform === 'win32' ? game.toUpperCase() : game,
        )
      ).id,
    ).toBe('project');
  });
});
