import type { Settings } from '../../../shared/domain';
import type { Database } from '../Database';

/** 設定の初期値 */
export const DEFAULT_SETTINGS: Settings = {
  theme: null,
  codexPath: '',
  codexModel: '',
  codexEffort: '',
  requestTimeoutSeconds: 60,
  turnIdleTimeoutMinutes: 10,
  desktopNotifications: true,
};

/** 設定の保存と読み込み。項目ごとに JSON で保存する */
export class SettingsRepository {
  constructor(private readonly db: Database) {}

  load(): Settings {
    const settings: Settings = { ...DEFAULT_SETTINGS };
    for (const row of this.db.all<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    )) {
      // 知らない項目（新しい版で足した設定など）は読み飛ばす
      if (row.key in settings) {
        (settings as unknown as Record<string, unknown>)[row.key] = JSON.parse(
          row.value,
        );
      }
    }
    return settings;
  }

  save(patch: Partial<Settings>): void {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        this.db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(value),
        );
      }
    });
  }
}
