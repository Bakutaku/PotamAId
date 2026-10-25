import type { StatusMeta } from '../lib/statusMeta';
import { BADGE_CLASS } from '../lib/tone';

/** 状態を示す小さなバッジ */
export function StatusBadge({ meta }: { meta: StatusMeta }) {
  if (!meta.label) {
    return null;
  }
  return (
    <span
      className={`badge badge-sm shrink-0 border-0 whitespace-nowrap ${BADGE_CLASS[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}
