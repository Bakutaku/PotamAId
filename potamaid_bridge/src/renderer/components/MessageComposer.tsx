import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

interface MessageComposerProps {
  /** 読み上げ用の説明（画面には出さない） */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** 送信する。true を返したら入力欄を空にする */
  onSubmit(text: string): Promise<boolean>;
}

/**
 * 指示や質問を書いて送る入力欄。
 * Enter で送信し、Shift+Enter で改行する（日本語の変換中の Enter は送信しない）。
 */
export function MessageComposer({
  label,
  placeholder,
  disabled = false,
  onSubmit,
}: MessageComposerProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = !disabled && !sending && text.trim().length > 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    setSending(true);
    try {
      if (await onSubmit(text)) {
        setText('');
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-base-300 px-4 py-3"
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        rows={1}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="textarea textarea-sm min-h-9 flex-1 resize-none"
      />
      <button
        type="submit"
        aria-label="送信"
        title="送信"
        disabled={!canSend}
        className="btn btn-square btn-sm h-9 w-9 text-primary"
      >
        {sending ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <Icon name="send" />
        )}
      </button>
    </form>
  );
}
