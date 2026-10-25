import type { ThemeName } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { IconButton } from '../../components/IconButton';
import { usePrefersDark } from '../../state/useTheme';
import { useRunAction } from '../../state/Toasts';

/** ライトとダークの切り替え。押すまでは OS の設定に合わせる */
export function ThemeToggle({ theme }: { theme: ThemeName | null }) {
  const prefersDark = usePrefersDark();
  const run = useRunAction();
  const isDark =
    (theme ?? (prefersDark ? 'potamaid-dark' : 'potamaid-light')) ===
    'potamaid-dark';
  return (
    <IconButton
      icon={isDark ? 'sun' : 'moon'}
      label={isDark ? 'ライトに切り替え' : 'ダークに切り替え'}
      onClick={() =>
        void run(() =>
          bridge.updateSettings({
            theme: isDark ? 'potamaid-light' : 'potamaid-dark',
          }),
        )
      }
    />
  );
}
