import type { Consult } from '../../../shared/domain';
import { StatusDot } from '../../components/StatusDot';
import { CONSULT_STATUS } from '../../lib/statusMeta';

/** サイドバーの相談の1件 */
export function ConsultListItem({
  consult,
  selected,
  onSelect,
}: {
  consult: Consult;
  selected: boolean;
  onSelect(): void;
}) {
  const meta = CONSULT_STATUS[consult.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-field px-2.5 py-1.5 text-left hover:bg-base-200 ${
        selected ? 'bg-primary/15 hover:bg-primary/20' : ''
      }`}
    >
      <StatusDot tone={consult.status === 'running' ? 'info' : 'neutral'} />
      <span className="min-w-0 flex-1 truncate">{consult.title}</span>
      {meta.label && (
        <span className="text-[11px] text-muted">{meta.label}</span>
      )}
    </button>
  );
}
