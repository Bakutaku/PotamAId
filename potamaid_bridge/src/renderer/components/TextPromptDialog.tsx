import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

interface TextPromptDialogProps {
  open: boolean;
  title: string;
  /** 入力欄の上の説明 */
  label: string;
  description?: string;
  placeholder?: string;
  submitLabel: string;
  /** 入力欄の下に足す項目（モデルの選択など） */
  children?: ReactNode;
  onClose(): void;
  /** 送信する。true を返したら閉じる */
  onSubmit(text: string): Promise<boolean>;
}

/** 文章を1つ書いて送るダイアログ（新しい目標・新しい相談・計画の作り直しなど） */
export function TextPromptDialog({
  open,
  title,
  label,
  description,
  placeholder,
  submitLabel,
  children,
  onClose,
  onSubmit,
}: TextPromptDialogProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // 開くたびに空にする
  useEffect(() => {
    if (open) {
      setText('');
    }
  }, [open]);

  const submit = async () => {
    if (!text.trim() || sending) {
      return;
    }
    setSending(true);
    try {
      if (await onSubmit(text)) {
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!text.trim() || sending}
            onClick={() => void submit()}
          >
            {sending && <span className="loading loading-spinner loading-xs" />}
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {description && <p className="text-muted">{description}</p>}
        <textarea
          id={id}
          rows={5}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Enter（macOS は Cmd+Enter）で送信する
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          className="textarea w-full"
        />
      </div>
      {children}
    </Dialog>
  );
}
