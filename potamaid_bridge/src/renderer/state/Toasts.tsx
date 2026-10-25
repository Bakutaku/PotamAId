/**
 * 画面の右下に出すお知らせ（主に操作の失敗）。
 * 操作は {@link useRunAction} で包むと、失敗したときに自動でお知らせを出す。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../api/bridge';

interface Toast {
  id: number;
  message: string;
}

/** お知らせを出しておく時間 */
const TOAST_DURATION_MS = 6000;

const ToastContext = createContext<((message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showError = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message }]);
    setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      TOAST_DURATION_MS,
    );
  }, []);

  return (
    <ToastContext.Provider value={showError}>
      {children}
      <div className="toast toast-end z-50" aria-live="assertive">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className="alert animate-toast-in alert-error shadow-lg"
          >
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Bridge への操作を実行し、失敗したらお知らせを出す関数を返す。
 * 成功したら true を返すので、入力欄を空にするかどうかの判断に使える。
 */
export function useRunAction(): (
  action: () => Promise<unknown>,
) => Promise<boolean> {
  const showError = useContext(ToastContext);
  if (!showError) {
    throw new Error('ToastProvider の中で使ってください');
  }
  return useMemo(
    () => async (action: () => Promise<unknown>) => {
      try {
        await action();
        return true;
      } catch (error) {
        showError(errorMessage(error));
        return false;
      }
    },
    [showError],
  );
}
