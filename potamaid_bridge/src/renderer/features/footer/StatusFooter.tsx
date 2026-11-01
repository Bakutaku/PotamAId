import type {
  ProviderStatus,
  GameConnectionStatus,
} from '../../../shared/domain';
import { StatusDot } from '../../components/StatusDot';
import { PROVIDER_STATE_TONE } from '../../lib/statusMeta';

/** フッター: ゲームとの接続、各プロバイダーの状態、トレイで動き続けることの案内 */
export function StatusFooter({
  providers,
  game,
}: {
  providers: ProviderStatus[];
  game?: GameConnectionStatus;
}) {
  return (
    <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-base-300 bg-base-100 px-4 py-1.5 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <StatusDot
          tone={
            game?.state === 'available'
              ? 'success'
              : game?.state === 'error'
                ? 'error'
                : 'neutral'
          }
        />
        ゲーム: {game?.message ?? 'ゲーム未接続'}
      </span>
      {providers.map((provider) => (
        <span key={provider.id} className="flex items-center gap-1.5">
          <StatusDot tone={PROVIDER_STATE_TONE[provider.state]} />
          {provider.displayName}:{' '}
          {provider.state === 'checking' ? '確認中…' : provider.message}
        </span>
      ))}
      <span className="ml-auto">
        ウィンドウを閉じてもタスクトレイで動き続けます
      </span>
    </footer>
  );
}
