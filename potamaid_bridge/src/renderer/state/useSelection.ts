/**
 * いま選ばれている対象mod・目標・相談・タスクを、スナップショットから求める。
 *
 * 選んでいたものが消えた場合や、まだ何も選んでいない場合は、最初のものを選んだことにする。
 */
import type { Consult, Goal, Project, Task } from '../../shared/domain';
import type { BridgeSnapshot } from '../../shared/ipc';
import { projectConsults, projectGoals } from '../lib/selectors';
import { useUiState, type MainView } from './UiState';

export interface Selection {
  project: Project | null;
  goals: Goal[];
  consults: Consult[];
  view: MainView | null;
  goal: Goal | null;
  consult: Consult | null;
  task: Task | null;
}

export function useSelection(snapshot: BridgeSnapshot): Selection {
  const { state } = useUiState();
  const project =
    snapshot.projects.find((p) => p.id === state.projectId) ??
    snapshot.projects[0] ??
    null;
  const goals = project ? projectGoals(snapshot, project.id) : [];
  const consults = project ? projectConsults(snapshot, project.id) : [];

  let view = state.view;
  const exists =
    view?.kind === 'goal'
      ? goals.some((g) => g.id === view?.id)
      : view?.kind === 'consult'
        ? consults.some((c) => c.id === view?.id)
        : false;
  if (!exists) {
    view = goals[0]
      ? { kind: 'goal', id: goals[0].id }
      : consults[0]
        ? { kind: 'consult', id: consults[0].id }
        : null;
  }

  const goal =
    view?.kind === 'goal'
      ? (goals.find((g) => g.id === view.id) ?? null)
      : null;
  const consult =
    view?.kind === 'consult'
      ? (consults.find((c) => c.id === view.id) ?? null)
      : null;
  const task =
    goal && state.taskId
      ? (snapshot.tasks.find(
          (t) => t.id === state.taskId && t.goalId === goal.id,
        ) ?? null)
      : null;

  return { project, goals, consults, view, goal, consult, task };
}
