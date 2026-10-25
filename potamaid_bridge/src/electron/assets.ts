import { app } from 'electron';
import path from 'node:path';

/**
 * `assets/` のファイルのパス。
 * パッケージでは forge.config.mts の extraResource で resources/assets に置かれる。
 */
export function assetPath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', name)
    : path.join(app.getAppPath(), 'assets', name);
}
