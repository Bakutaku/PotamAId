import type { ProviderId, ProviderStatus } from '../../shared/domain';
import type { AiProvider } from './AiProvider';

/** 準備中のプロバイダー（画面に「準備中」と出すためだけに使う） */
const PLANNED_PROVIDERS: { id: ProviderId; displayName: string }[] = [
  { id: 'claude', displayName: 'Claude' },
];

/**
 * 使えるプロバイダーの一覧。
 * Claude（Agent SDK）に対応するときは、実装をここに登録する。
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AiProvider>();

  constructor(providers: AiProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  /** 指定したプロバイダーを返す。登録されていなければ例外 */
  get(id: ProviderId): AiProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`プロバイダー ${id} には対応していません`);
    }
    return provider;
  }

  /** 新しい目標・相談に使うプロバイダー（今は Codex だけ） */
  get defaultId(): ProviderId {
    return 'codex';
  }

  /** すべてのプロバイダーの状態。準備中のものも含める */
  async statuses(): Promise<ProviderStatus[]> {
    const ready = await Promise.all(
      [...this.providers.values()].map((p) => p.getStatus()),
    );
    const planned = PLANNED_PROVIDERS.filter(
      (p) => !this.providers.has(p.id),
    ).map<ProviderStatus>((p) => ({
      ...p,
      state: 'notSupported',
      message: '準備中',
      models: [],
    }));
    return [...ready, ...planned];
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.providers.values()].map((p) => p.dispose()));
  }
}
