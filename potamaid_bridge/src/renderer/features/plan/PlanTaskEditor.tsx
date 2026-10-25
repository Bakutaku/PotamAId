import { useEffect, useId, useState } from 'react';
import type { Task, TaskKind } from '../../../shared/domain';
import type { PlanTaskInput } from '../../../shared/ipc';
import { Dialog } from '../../components/Dialog';

const KIND_OPTIONS: { kind: TaskKind; label: string; description: string }[] = [
  {
    kind: 'edit',
    label: '編集',
    description: 'ファイルを編集する。対象modごとに 1 件ずつ実行する',
  },
  {
    kind: 'investigate',
    label: '調査',
    description:
      '読み取り専用で調べるだけ。ほかのタスクと並行して実行し、結果を後のタスクに渡す',
  },
];

interface PlanTaskEditorProps {
  open: boolean;
  /** 編集するタスク。null なら追加 */
  task: Task | null;
  /** 同じ目標のタスク（依存先の候補） */
  tasks: Task[];
  onClose(): void;
  /** 保存する。true を返したら閉じる */
  onSave(input: PlanTaskInput): Promise<boolean>;
}

/** 計画のタスクを追加・編集するダイアログ（題名・内容・種類・依存するタスク） */
export function PlanTaskEditor({
  open,
  task,
  tasks,
  onClose,
  onSave,
}: PlanTaskEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const kindName = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<TaskKind>('edit');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 開いたときだけ、編集するタスクの内容を入れ直す
  // （開いている間に状態が届いても、入力中の内容を消さないため ID だけを見る）
  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      setKind(task?.kind ?? 'edit');
      setDependsOn(task?.dependsOn ?? []);
    }
  }, [open, task?.id]); // oxlint-disable-line react-hooks/exhaustive-deps

  const candidates = tasks.filter((t) => t.id !== task?.id);
  const toggle = (id: string) =>
    setDependsOn((list) =>
      list.includes(id) ? list.filter((d) => d !== id) : [...list, id],
    );

  const save = async () => {
    setSaving(true);
    try {
      if (await onSave({ title, description, kind, dependsOn })) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={task ? `タスク #${task.number} を編集` : 'タスクを追加'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!title.trim() || saving}
            onClick={() => void save()}
          >
            保存
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={titleId} className="font-medium">
          題名
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input input-sm w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionId} className="font-medium">
          内容
        </label>
        <textarea
          id={descriptionId}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="textarea w-full"
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">種類</legend>
        {KIND_OPTIONS.map((option) => (
          <label key={option.kind} className="flex items-start gap-2">
            <input
              type="radio"
              name={kindName}
              className="radio radio-sm mt-0.5"
              checked={kind === option.kind}
              onChange={() => setKind(option.kind)}
            />
            <span className="flex flex-col">
              {option.label}
              <span className="text-xs text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {candidates.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">先に完了しているタスク</legend>
          {candidates.map((candidate) => (
            <label key={candidate.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={dependsOn.includes(candidate.id)}
                onChange={() => toggle(candidate.id)}
              />
              #{candidate.number} {candidate.title}
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
