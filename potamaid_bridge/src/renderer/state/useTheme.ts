import { useEffect, useRef, useSyncExternalStore } from 'react';
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
  // 起動して最初に当てるときは、切り替えの動きを出さない
  const applied = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (theme) {
        root.dataset.theme = theme;
      } else {
        delete root.dataset.theme;
      }
    };
    if (applied.current) {
      // 色を1つずつ変えるとちらつくので、画面全体を入れ替える動きにする
      document.startViewTransition(apply);
    } else {
      apply();
      applied.current = true;
    }
  }, [theme]);
}
