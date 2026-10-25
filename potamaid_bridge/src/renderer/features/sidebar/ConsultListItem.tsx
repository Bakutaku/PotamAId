import type { Consult } from '../../../shared/domain';
import { StatusDot } from '../../components/StatusDot';
import { CONSULT_STATUS } from '../../lib/statusMeta';
import { SELECTABLE_ITEM_CLASS, SELECTED_ITEM_CLASS } from './itemClasses';

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
      className={`${SELECTABLE_ITEM_CLASS} items-center gap-2 py-1.5 ${
        selected ? SELECTED_ITEM_CLASS : ''
      }`}
    >
      <StatusDot
        tone={consult.status === 'running' ? 'info' : 'neutral'}
        pulse={consult.status === 'running'}
      />
      <span className="min-w-0 flex-1 truncate">{consult.title}</span>
      {meta.label && (
        <span className="text-[11px] text-muted">{meta.label}</span>
      )}
    </button>
  );
}
