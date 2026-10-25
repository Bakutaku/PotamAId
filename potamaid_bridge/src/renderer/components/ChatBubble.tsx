import { Markdown } from './Markdown';

/**
 * 会話の吹き出し（daisyUI の chat）。ユーザーの発言は右、AI の発言は左に出す。
 * AI の発言は Markdown として、ユーザーの発言は書いたままの文字として表示する。
 */
export function ChatBubble({
  from,
  text,
}: {
  from: 'user' | 'ai';
  text: string;
}) {
  return (
    <div className={`chat ${from === 'user' ? 'chat-end' : 'chat-start'}`}>
      <div
        className={`chat-bubble max-w-[85%] text-base-content ${
          from === 'user' ? 'bg-primary/15 whitespace-pre-wrap' : 'bg-base-200'
        }`}
      >
        {from === 'ai' ? <Markdown>{text}</Markdown> : text}
      </div>
    </div>
  );
}
