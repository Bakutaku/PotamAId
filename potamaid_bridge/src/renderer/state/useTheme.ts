import { useEffect, useSyncExternalStore } from 'react';
import type { ThemeName } from '../../shared/domain';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** OS がダークの設定か */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(DARK_QUERY);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => window.matchMedia(DARK_QUERY).matches,
  );
}

/**
 * テーマを画面に当てる。null のときは data-theme を外し、
 * daisyUI のテーマの prefersdark で OS の設定に合わせる。
 */
export function useApplyTheme(theme: ThemeName | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
  }, [theme]);
}
