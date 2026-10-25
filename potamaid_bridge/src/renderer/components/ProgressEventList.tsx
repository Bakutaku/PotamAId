import type { ProgressEvent } from '../../shared/domain';
import { PROGRESS_TAG } from '../lib/statusMeta';
import { Markdown } from './Markdown';

/**
 * 途中経過の一覧（思考・ツールの実行・途中の発言など）。
 * 詳しい内容（コマンドの出力や差分）がある行は、開いて見られる。
 */
export function ProgressEventList({ events }: { events: ProgressEvent[] }) {
  if (events.length === 0) {
    return null;
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {events.map((event) => (
        <li key={event.seq} className="flex items-baseline gap-2 text-muted">
          <span
            className={`w-12 shrink-0 rounded-md border px-1 text-center text-[11px] ${
              event.kind === 'error'
                ? 'border-error/40 bg-error/10 text-error-strong'
                : 'border-base-300 bg-base-200 text-base-content'
            }`}
          >
            {PROGRESS_TAG[event.kind]}
          </span>
          <ProgressText event={event} />
        </li>
      ))}
    </ol>
  );
}

function ProgressText({ event }: { event: ProgressEvent }) {
  const textClass =
    event.kind === 'agent' || event.kind === 'user' ? 'text-base-content' : '';
  // AI の発言は Markdown で書かれることが多いので、整えて表示する
  if (event.kind === 'agent') {
    return (
      <div className="min-w-0 flex-1 text-base-content">
        <Markdown>{event.text}</Markdown>
      </div>
    );
  }
  if (!event.detail) {
    return (
      <span className={`min-w-0 break-words whitespace-pre-wrap ${textClass}`}>
        {event.text}
      </span>
    );
  }
  return (
    <details className="min-w-0 flex-1">
      <summary className={`cursor-pointer break-words ${textClass}`}>
        {event.text}
      </summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-base-200 p-2 font-mono text-[11px] whitespace-pre-wrap">
        {event.detail}
      </pre>
    </details>
  );
}
