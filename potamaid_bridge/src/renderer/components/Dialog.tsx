import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  /** 下に並べるボタン */
  actions?: ReactNode;
}

/**
 * モーダルのダイアログ（daisyUI の modal と HTML の dialog 要素）。
 * Esc キーや背景のクリックで閉じる。
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="modal-box flex max-w-lg flex-col gap-4">
        <h2 className="text-base font-bold">{title}</h2>
        {children}
        {actions && <div className="modal-action mt-0">{actions}</div>}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="閉じる">
          閉じる
        </button>
      </form>
    </dialog>
  );
}
