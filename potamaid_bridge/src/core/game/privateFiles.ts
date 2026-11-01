import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  stat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** 秘密を置く前にディレクトリと一時ファイルを現在の利用者だけに制限する。 */
export async function protect(file: string): Promise<void> {
  if ((await lstat(file)).isSymbolicLink())
    throw new Error('接続情報の保存先にリンクは使えません');
  if (process.platform === 'win32') {
    const literal = file.replaceAll("'", "''");
    const script = `$ErrorActionPreference='Stop'; $p='${literal}'; $item=if([System.IO.Directory]::Exists($p)){[System.IO.DirectoryInfo]::new($p)}else{[System.IO.FileInfo]::new($p)}; $acl=$item.GetAccessControl(); $acl.SetAccessRuleProtection($true,$false); foreach($rule in @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($rule)}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'); $acl.AddAccessRule($rule); $item.SetAccessControl($acl); $check=$item.GetAccessControl(); $rules=$check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); if(-not $check.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value){throw 'ACL validation failed'}`;
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true },
    );
  } else {
    await chmod(file, (await lstat(file)).isDirectory() ? 0o700 : 0o600);
  }
}

export async function writePrivateJson(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await protect(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await protect(temp);
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
    await handle.close();
    await rename(temp, file);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true });
  }
}

export async function normalizeProjectRoot(input: string): Promise<string> {
  if (!path.isAbsolute(input) || !(await stat(input)).isDirectory())
    throw new Error('実在する絶対パスを指定してください');
  const resolved = await realpath(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
