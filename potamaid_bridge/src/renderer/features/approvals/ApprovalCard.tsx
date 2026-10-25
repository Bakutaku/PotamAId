/**
 * 承認待ちの1件の中身と回答の操作。
 * ボードの上の承認待ちの枠と、タスクの詳細・相談・計画づくりの画面で使う。
 *
 * - コマンド・ファイルの変更: 拒否 / このセッションの間は許可 / 許可
 * - AI からの質問: 選択肢か自由な回答で答える
 * - MCP の入力フォーム: 項目を入力して送る
 * - MCP の URL を開く要求: URL を開いて操作してから「完了した」を押す
 */
import { useState, type ReactNode } from 'react';
import type {
  Approval,
  ApprovalResponse,
  FormField,
} from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { useRunAction } from '../../state/Toasts';
import { FormFieldInput, type FieldValue } from './FormFieldInput';

export function ApprovalCard({ approval }: { approval: Approval }) {
  switch (approval.kind) {
    case 'command':
    case 'fileChange':
      return <PermissionApproval approval={approval} />;
    case 'question':
      return <QuestionApproval approval={approval} />;
    case 'form':
      return <FormApproval approval={approval} />;
    case 'url':
      return <UrlApproval approval={approval} />;
  }
}

/** 回答を送る。送っている間は true を返す */
function useRespond(approvalId: string) {
  const run = useRunAction();
  const [busy, setBusy] = useState(false);
  const respond = async (response: ApprovalResponse) => {
    setBusy(true);
    await run(() => bridge.respondApproval(approvalId, response));
    setBusy(false);
  };
  return { busy, respond };
}

function PermissionApproval({ approval }: { approval: Approval }) {
  const { busy, respond } = useRespond(approval.id);
  const target =
    approval.kind === 'command'
      ? (approval.command ?? 'コマンドの実行')
      : approval.files.join('\n') || 'ファイルの変更';
  return (
    <ApprovalBody
      title={
        approval.kind === 'command'
          ? 'コマンドの実行の許可'
          : 'ファイルの変更の許可'
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'deny' })}
          >
            拒否
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            title="このタスクのセッションの間は、同じ種類の操作を確かめずに許可します"
            onClick={() => void respond({ decision: 'allowForSession' })}
          >
            このセッションの間は許可
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'allow' })}
          >
            許可
          </button>
        </>
      }
    >
      <code className="block rounded-md border border-base-300 bg-base-100 px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
        {target}
      </code>
      {approval.cwd && (
        <span className="text-[11px] text-muted">場所: {approval.cwd}</span>
      )}
      {approval.reason && <span>{approval.reason}</span>}
    </ApprovalBody>
  );
}

/** 自由な回答を選んだことを表す、選択肢の値 */
const OTHER = '\u0000other';

function QuestionApproval({ approval }: { approval: Approval }) {
  const { busy, respond } = useRespond(approval.id);
  // 質問の ID → 選んだ選択肢（OTHER なら自由な回答）
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<Record<string, string>>({});

  const answerOf = (id: string, hasOptions: boolean): string => {
    const choice = choices[id];
    return !hasOptions || choice === OTHER
      ? (others[id] ?? '').trim()
      : (choice ?? '');
  };
  const complete = approval.questions.every(
    (q) => answerOf(q.id, q.options.length > 0) !== '',
  );

  const submit = () =>
    respond({
      decision: 'allow',
      answers: Object.fromEntries(
        approval.questions.map((q) => [
          q.id,
          [answerOf(q.id, q.options.length > 0)],
        ]),
      ),
    });

  return (
    <ApprovalBody
      title="AI からの質問"
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'deny' })}
          >
            回答しない
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !complete}
            onClick={() => void submit()}
          >
            回答する
          </button>
        </>
      }
    >
      {approval.questions.map((question) => {
        const hasOptions = question.options.length > 0;
        const name = `${approval.id}-${question.id}`;
        return (
          <fieldset key={question.id} className="flex flex-col gap-1.5">
            <legend className="mb-1">
              {question.header && (
                <span className="mr-2 font-bold">{question.header}</span>
              )}
              {question.question}
            </legend>
            {question.options.map((option) => (
              <label key={option.label} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={name}
                  className="radio radio-sm mt-0.5"
                  checked={choices[question.id] === option.label}
                  onChange={() =>
                    setChoices((c) => ({ ...c, [question.id]: option.label }))
                  }
                />
                <span>
                  {option.label}
                  {option.description && (
                    <span className="block text-xs text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {question.allowOther && hasOptions && (
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  className="radio radio-sm"
                  checked={choices[question.id] === OTHER}
                  onChange={() =>
                    setChoices((c) => ({ ...c, [question.id]: OTHER }))
                  }
                />
                その他
              </label>
            )}
            {(!hasOptions || choices[question.id] === OTHER) && (
              <input
                type={question.secret ? 'password' : 'text'}
                aria-label={`${question.header || question.question} の回答`}
                value={others[question.id] ?? ''}
                onChange={(e) =>
                  setOthers((o) => ({ ...o, [question.id]: e.target.value }))
                }
                className="input input-sm w-full"
              />
            )}
          </fieldset>
        );
      })}
    </ApprovalBody>
  );
}

function FormApproval({ approval }: { approval: Approval }) {
  const { busy, respond } = useRespond(approval.id);
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(approval.fields.map((f) => [f.name, initialValue(f)])),
  );
  const missing = approval.fields.some(
    (f) => f.required && isEmpty(values[f.name]),
  );

  const submit = () =>
    respond({
      decision: 'allow',
      // 空の項目は送らない
      values: Object.fromEntries(
        Object.entries(values).filter(
          (entry): entry is [string, string | number | boolean | string[]] =>
            !isEmpty(entry[1]),
        ),
      ),
    });

  return (
    <ApprovalBody
      title={`入力の要求（${approval.source ?? 'MCP'}）`}
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'deny' })}
          >
            拒否
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || missing}
            onClick={() => void submit()}
          >
            送信
          </button>
        </>
      }
    >
      {approval.message && <span>{approval.message}</span>}
      {approval.fields.map((field) => (
        <FormFieldInput
          key={field.name}
          field={field}
          value={values[field.name] ?? null}
          onChange={(value) =>
            setValues((v) => ({ ...v, [field.name]: value }))
          }
        />
      ))}
    </ApprovalBody>
  );
}

function UrlApproval({ approval }: { approval: Approval }) {
  const { busy, respond } = useRespond(approval.id);
  return (
    <ApprovalBody
      title={`URL を開く要求（${approval.source ?? 'MCP'}）`}
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'deny' })}
          >
            拒否
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void respond({ decision: 'allow' })}
          >
            完了した
          </button>
        </>
      }
    >
      {approval.message && <span>{approval.message}</span>}
      {approval.url && (
        <a
          href={approval.url}
          target="_blank"
          rel="noreferrer"
          className="link link-primary break-all"
        >
          {approval.url}
        </a>
      )}
      <span className="text-xs text-muted">
        既定のブラウザーで開いて操作が終わったら「完了した」を押してください。
      </span>
    </ApprovalBody>
  );
}

/** 承認待ちの中身の共通の形（見出し・内容・右下のボタン） */
function ApprovalBody({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold text-warning-strong">{title}</div>
      {children}
      <div className="flex flex-wrap justify-end gap-1.5">{actions}</div>
    </div>
  );
}

function initialValue(field: FormField): FieldValue {
  if (field.defaultValue !== null) {
    return field.defaultValue;
  }
  if (field.kind === 'boolean') {
    return false;
  }
  return field.kind === 'multiSelect' ? [] : null;
}

function isEmpty(value: FieldValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}
