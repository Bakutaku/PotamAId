/**
 * 画面だけで持つ状態（選んでいる対象mod・表示しているもの・開いているダイアログ）。
 * Bridge の本体には保存しない。
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

/** メインの領域に表示するもの */
export type MainView =
  | { kind: 'goal'; id: string }
  | { kind: 'consult'; id: string };

export type DialogKind = 'newGoal' | 'newConsult' | 'settings';

export interface UiState {
  projectId: string | null;
  view: MainView | null;
  /** 詳細を開いているタスク */
  taskId: string | null;
  dialog: DialogKind | null;
}

type UiAction =
  | { type: 'selectProject'; projectId: string }
  | { type: 'showView'; view: MainView; projectId?: string }
  | {
      type: 'selectTask';
      taskId: string | null;
      goalId?: string;
      projectId?: string;
    }
  | { type: 'openDialog'; dialog: DialogKind }
  | { type: 'closeDialog' };

const initialState: UiState = {
  projectId: null,
  view: null,
  taskId: null,
  dialog: null,
};

function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'selectProject':
      return state.projectId === action.projectId
        ? state
        : { ...state, projectId: action.projectId, view: null, taskId: null };
    case 'showView':
      return {
        ...state,
        projectId: action.projectId ?? state.projectId,
        view: action.view,
        taskId: null,
      };
    case 'selectTask':
      return {
        ...state,
        projectId: action.projectId ?? state.projectId,
        view: action.goalId ? { kind: 'goal', id: action.goalId } : state.view,
        taskId: action.taskId,
      };
    case 'openDialog':
      return { ...state, dialog: action.dialog };
    case 'closeDialog':
      return { ...state, dialog: null };
  }
}

interface UiContextValue {
  state: UiState;
  selectProject(projectId: string): void;
  showView(view: MainView, projectId?: string): void;
  selectTask(
    taskId: string | null,
    options?: { goalId?: string; projectId?: string },
  ): void;
  openDialog(dialog: DialogKind): void;
  closeDialog(): void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo<UiContextValue>(
    () => ({
      state,
      selectProject: (projectId) =>
        dispatch({ type: 'selectProject', projectId }),
      showView: (view, projectId) =>
        dispatch({ type: 'showView', view, projectId }),
      selectTask: (taskId, options) =>
        dispatch({ type: 'selectTask', taskId, ...options }),
      openDialog: (dialog) => dispatch({ type: 'openDialog', dialog }),
      closeDialog: () => dispatch({ type: 'closeDialog' }),
    }),
    [state],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUiState(): UiContextValue {
  const value = useContext(UiContext);
  if (!value) {
    throw new Error('UiStateProvider の中で使ってください');
  }
  return value;
}
