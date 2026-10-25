/**
 * 相談（ボードとは別に、チャットの形で表示する）。
 */
import { useEffect, useRef } from 'react';
import type { Approval, Consult, ProgressEvent } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { ChatBubble } from '../../components/ChatBubble';
import { Icon } from '../../components/Icon';
import { MessageComposer } from '../../components/MessageComposer';
import { ProgressEventList } from '../../components/ProgressEventList';
import { RunningIndicator } from '../../components/RunningIndicator';
import { useProgressEvents } from '../../state/useProgressEvents';
import { useRunAction } from '../../state/Toasts';
import { InlineApprovals } from '../approvals/InlineApprovals';

/** 会話の吹き出しにする途中経過の種類（それ以外はまとめて小さく出す） */
const CHAT_KINDS = new Set<ProgressEvent['kind']>(['user', 'agent']);

export function ConsultView({
  consult,
  runLabel,
  approvals,
}: {
  consult: Consult;
  /** 使う AI の説明（プロバイダー・モデル・思考量） */
  runLabel: string;
  /** この相談の承認待ち（AI からの質問など） */
  approvals: Approval[];
}) {
  const run = useRunAction();
  const { events, streaming } = useProgressEvents({
    type: 'consult',
    id: consult.id,
  });
  const busy = consult.status === 'running' || consult.status === 'queued';
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新しい発言が届いたら、いちばん下まで送る
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [events.length, streaming?.text]);

  return (
    <section
      aria-label="相談"
      className="flex min-h-[280px] max-w-[860px] flex-1 flex-col rounded-box border border-base-300 bg-base-100"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-3">
        <h1 className="text-[15px] font-bold">{consult.title}</h1>
        <span className="badge badge-sm border-0 bg-base-200 text-muted">
          相談・読み取り専用
        </span>
        <span className="text-xs text-muted">{runLabel}</span>
        {busy && (
          <button
            type="button"
            className="btn btn-sm ml-auto"
            onClick={() => void run(() => bridge.cancelConsult(consult.id))}
          >
            <Icon name="stop" size={14} />
            中止
          </button>
        )}
        {/* 相談から目標を作る機能は案の段階のため、まだ使えない */}
        <button
          type="button"
          disabled
          title="相談から目標を作る機能は未決定のため、まだ使えません"
          className={`btn btn-sm ${busy ? '' : 'ml-auto'}`}
        >
          この相談から目標を作る
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {groupEvents(events).map((group) =>
          group.kind === 'chat' ? (
            <ChatBubble
              key={group.event.seq}
              from={group.event.kind === 'user' ? 'user' : 'ai'}
              text={group.event.text}
            />
          ) : (
            <div key={group.events[0].seq} className="px-1">
              <ProgressEventList events={group.events} />
            </div>
          ),
        )}
        {streaming && <ChatBubble from="ai" text={streaming.text} />}
        <InlineApprovals approvals={approvals} />
        {consult.status === 'running' && !streaming && <RunningIndicator />}
        {consult.status === 'queued' && (
          <RunningIndicator label="順番待ちです。読み取り専用の実行枠が空くと始めます" />
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        label="相談する"
        placeholder={
          busy
            ? '応答が終わってから送れます'
            : 'Capability はいつ登録すればいい？'
        }
        disabled={busy}
        onSubmit={(text) =>
          run(() => bridge.sendConsultMessage(consult.id, text))
        }
      />
    </section>
  );
}

type EventGroup =
  | { kind: 'chat'; event: ProgressEvent }
  | { kind: 'progress'; events: ProgressEvent[] };

/** 発言は吹き出しに、続けて届いたそれ以外の途中経過は1つの一覧にまとめる */
function groupEvents(events: ProgressEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of events) {
    if (CHAT_KINDS.has(event.kind)) {
      groups.push({ kind: 'chat', event });
      continue;
    }
    const last = groups.at(-1);
    if (last?.kind === 'progress') {
      last.events.push(event);
    } else {
      groups.push({ kind: 'progress', events: [event] });
    }
  }
  return groups;
}
