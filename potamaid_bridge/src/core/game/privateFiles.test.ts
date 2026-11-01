import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { writePrivateJson } from './privateFiles';

it('接続情報のアクセス権を制限し、一時ファイルから置き換える', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'potamaid-acl-'));
  try {
    const file = path.join(directory, 'private', 'test.json');
    await writePrivateJson(file, { test: 1 });
    await writePrivateJson(file, { test: 2 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ test: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
