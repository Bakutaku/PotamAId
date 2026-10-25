/**
 * サイドバー: 対象modの「目標」の一覧と「相談」の一覧。
 */
import type { BridgeSnapshot } from '../../../shared/ipc';
import { Icon } from '../../components/Icon';
import { SectionHeader } from '../../components/SectionHeader';
import { goalTasks } from '../../lib/selectors';
import type { Selection } from '../../state/useSelection';
import { useUiState } from '../../state/UiState';
import { ConsultListItem } from './ConsultListItem';
import { GoalListItem } from './GoalListItem';

export function Sidebar({
  snapshot,
  selection,
}: {
  snapshot: BridgeSnapshot;
  selection: Selection;
}) {
  const { showView, openDialog } = useUiState();
  const { goals, consults, view } = selection;

  return (
    <nav
      aria-label="目標と相談"
      className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-base-300 bg-base-100 px-2 py-3"
    >
      <SectionHeader
        title="目標"
        action={
          <NewButton label="新しい目標" onClick={() => openDialog('newGoal')} />
        }
      />
      {goals.length === 0 && <EmptyNote>まだ目標はありません</EmptyNote>}
      {goals.map((goal) => (
        <GoalListItem
          key={goal.id}
          goal={goal}
          tasks={goalTasks(snapshot, goal.id)}
          selected={view?.kind === 'goal' && view.id === goal.id}
          onSelect={() => showView({ kind: 'goal', id: goal.id })}
        />
      ))}

      <div className="pt-3.5">
        <SectionHeader
          title="相談"
          action={
            <NewButton
              label="新しい相談"
              onClick={() => openDialog('newConsult')}
            />
          }
        />
      </div>
      {consults.length === 0 && <EmptyNote>まだ相談はありません</EmptyNote>}
      {consults.map((consult) => (
        <ConsultListItem
          key={consult.id}
          consult={consult}
          selected={view?.kind === 'consult' && view.id === consult.id}
          onSelect={() => showView({ kind: 'consult', id: consult.id })}
        />
      ))}
    </nav>
  );
}

function NewButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-ghost btn-xs">
      <Icon name="plus" size={13} />
      {label}
    </button>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="px-2.5 py-1 text-xs text-muted">{children}</p>;
}
