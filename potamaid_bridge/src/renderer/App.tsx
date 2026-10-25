/**
 * Bridge の画面の全体（モックの「メイン画面（目標・タスク・相談）」）。
 *
 * ヘッダー / サイドバー（目標と相談）/ メイン（承認待ち・ボード・計画の確認・相談）/
 * タスクの詳細 / フッター の構成。
 */
import { useRef } from 'react';
import type { Approval, Consult, Goal } from '../shared/domain';
import type { BridgeSnapshot } from '../shared/ipc';
import logo from '../../assets/river-spirit.png';
import { EmptyState } from './components/EmptyState';
import { ApprovalBanner } from './features/approvals/ApprovalBanner';
import { GoalBoard } from './features/board/GoalBoard';
import { ConsultView } from './features/consult/ConsultView';
import { NewConsultDialog } from './features/consult/NewConsultDialog';
import { StatusFooter } from './features/footer/StatusFooter';
import { NewGoalDialog } from './features/goal/NewGoalDialog';
import { AppHeader } from './features/header/AppHeader';
import { GoalPlanningView } from './features/plan/GoalPlanningView';
import { PlanReview } from './features/plan/PlanReview';
import { NoProjects } from './features/project/NoProjects';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { Sidebar } from './features/sidebar/Sidebar';
import { TaskDetail } from './features/task/TaskDetail';
import { describeRun } from './lib/runOptions';
import {
  goalTasks,
  isGoalStarted,
  ownerApprovals,
  projectApprovals,
} from './lib/selectors';
import { useBridgeSnapshot } from './state/snapshotStore';
import { ToastProvider } from './state/Toasts';
import { UiStateProvider, useUiState } from './state/UiState';
import { useSelection, type Selection } from './state/useSelection';
import { useApplyTheme } from './state/useTheme';
import { useUiCommands } from './state/useUiCommands';

export default function App() {
  return (
    <ToastProvider>
      <UiStateProvider>
        <Shell />
      </UiStateProvider>
    </ToastProvider>
  );
}

/** 最初の状態が届くまでは読み込み中を出す */
function Shell() {
  const snapshot = useBridgeSnapshot();
  useApplyTheme(snapshot?.settings.theme);
  if (!snapshot) {
    return (
      <div
        role="status"
        className="flex h-full flex-col items-center justify-center gap-3"
      >
        <img
          src={logo}
          alt=""
          className="size-14 animate-bob [image-rendering:pixelated]"
        />
        <span className="flex items-center gap-2 text-muted">
          <span className="loading loading-dots loading-xs" aria-hidden />
          読み込み中
        </span>
      </div>
    );
  }
  return <MainScreen snapshot={snapshot} />;
}

function MainScreen({ snapshot }: { snapshot: BridgeSnapshot }) {
  const selection = useSelection(snapshot);
  const approvalsRef = useRef<HTMLElement>(null);
  useUiCommands(snapshot, approvalsRef);

  const { project, goal, task } = selection;
  const approvals = project ? projectApprovals(snapshot, project.id) : [];
  const codex = snapshot.providers.find((p) => p.id === 'codex');

  return (
    <div className="flex h-full flex-col">
      <AppHeader snapshot={snapshot} project={project} />
      <div className="flex min-h-0 flex-1">
        {project && <Sidebar snapshot={snapshot} selection={selection} />}
        {/* 承認待ちの枠は上に固定し、その下の内容だけをスクロールする */}
        <main className="flex min-w-0 flex-1 flex-col">
          {project ? (
            <>
              <ApprovalBanner
                ref={approvalsRef}
                snapshot={snapshot}
                approvals={approvals}
              />
              {/* 見るものが変わったら作り直し、ふわっと出す */}
              <div
                key={contentKey(selection)}
                className="flex min-h-0 flex-1 animate-fade-in flex-col gap-3.5 overflow-y-auto p-4"
              >
                <MainContent
                  snapshot={snapshot}
                  selection={selection}
                  approvals={approvals}
                />
              </div>
            </>
          ) : (
            <div className="overflow-y-auto p-4">
              <NoProjects />
            </div>
          )}
        </main>
        {goal && task && isGoalStarted(goal) && (
          <TaskDetail
            goal={goal}
            task={task}
            tasks={goalTasks(snapshot, goal.id)}
            approvals={ownerApprovals(approvals, { type: 'task', id: task.id })}
            runLabel={runLabel(snapshot, goal)}
          />
        )}
      </div>
      <StatusFooter providers={snapshot.providers} />

      <NewGoalDialog
        project={project}
        settings={snapshot.settings}
        provider={codex}
      />
      <NewConsultDialog
        project={project}
        settings={snapshot.settings}
        provider={codex}
      />
      <SettingsDialog
        settings={snapshot.settings}
        project={project}
        providers={snapshot.providers}
      />
    </div>
  );
}

/** メインの領域: 目標の状態に応じた表示、または相談 */
function MainContent({
  snapshot,
  selection,
  approvals,
}: {
  snapshot: BridgeSnapshot;
  selection: Selection;
  /** 対象modの承認待ち */
  approvals: Approval[];
}) {
  const { openDialog } = useUiState();
  const { goal, consult, task } = selection;

  if (consult) {
    return (
      <ConsultView
        consult={consult}
        runLabel={runLabel(snapshot, consult)}
        approvals={ownerApprovals(approvals, {
          type: 'consult',
          id: consult.id,
        })}
      />
    );
  }
  if (!goal) {
    return (
      <EmptyState
        title="目標か相談を作ってください"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openDialog('newGoal')}
            >
              新しい目標
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openDialog('newConsult')}
            >
              新しい相談
            </button>
          </div>
        }
      >
        目標は、AI
        が計画を作ってからタスクごとに実装します。相談は、実装を伴わない質問・調べものです。
      </EmptyState>
    );
  }

  const tasks = goalTasks(snapshot, goal.id);
  switch (goal.status) {
    case 'planning':
    case 'planFailed':
      return (
        <GoalPlanningView
          goal={goal}
          runLabel={runLabel(snapshot, goal)}
          approvals={ownerApprovals(approvals, { type: 'goal', id: goal.id })}
        />
      );
    case 'planReview':
      return <PlanReview goal={goal} tasks={tasks} />;
    case 'active':
    case 'review':
    case 'done':
      return (
        <GoalBoard
          goal={goal}
          tasks={tasks}
          selectedTaskId={task?.id ?? null}
        />
      );
  }
}

/**
 * メインの領域の表示を区別する値。
 * 目標は「計画づくり → 計画の確認 → ボード」と表示が変わるので、その段階も含める
 */
function contentKey({ view, goal }: Selection): string {
  if (!view) {
    return 'empty';
  }
  const stage = !goal
    ? ''
    : goal.status === 'planning' || goal.status === 'planFailed'
      ? 'planning'
      : goal.status === 'planReview'
        ? 'planReview'
        : 'board';
  return `${view.kind}:${view.id}:${stage}`;
}

/** 目標・相談の AI の説明（「Codex・gpt-x・思考量 中」など） */
function runLabel(snapshot: BridgeSnapshot, target: Goal | Consult): string {
  const provider = snapshot.providers.find((p) => p.id === target.providerId);
  const name = provider?.displayName ?? target.providerId;
  return `${name}・${describeRun(target, snapshot.settings, provider)}`;
}
