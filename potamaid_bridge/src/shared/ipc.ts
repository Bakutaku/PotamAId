/**
 * Bridge の本体（main プロセス）と画面（renderer）の間のやり取りの型。
 *
 * 画面からの操作は {@link BridgeApi} のメソッドとして定義する。
 * preload と main は {@link BRIDGE_API_METHODS} から機械的に
 * `ipcRenderer.invoke` と `ipcMain.handle` を組み立てるため、
 * 操作を増やすときは、ここの型と一覧、main 側の実装を足すだけでよい。
 */
import type {
  Approval,
  ApprovalResponse,
  Consult,
  Goal,
  ProgressEvent,
  ProgressOwner,
  Project,
  ProviderStatus,
  RunOptions,
  Settings,
  Task,
  TaskKind,
  TaskWeight,
  WeightProfiles,
} from './domain';

/** 対象modごとの実行の数（ヘッダーとトレイに出す） */
export interface RunCounts {
  /** 実行中の編集タスク（承認待ちを含む） */
  edit: number;
  editLimit: number;
  /** 実行中の読み取り専用の実行（計画の作成・調査タスク・相談） */
  readOnly: number;
  readOnlyLimit: number;
  /** 順番待ちの読み取り専用の実行 */
  queued: number;
}

/**
 * 画面に送る Bridge の状態のまとめ。
 * 途中経過は量が多いため含めず、{@link BridgeApi.getProgressEvents} とプッシュで別に受け取る。
 */
export interface BridgeSnapshot {
  projects: Project[];
  goals: Goal[];
  tasks: Task[];
  consults: Consult[];
  approvals: Approval[];
  runs: Record<string, RunCounts>;
  settings: Settings;
  providers: ProviderStatus[];
}

/** 計画のタスクを追加・編集するときの内容 */
export interface PlanTaskInput {
  title: string;
  description: string;
  kind: TaskKind;
  weight: TaskWeight;
  /** 直接指定する実行の設定。null なら重さで決める */
  profileId: string | null;
  /** 依存するタスクの ID */
  dependsOn: string[];
}

/** タスクの実行の設定の変更（未着手・失敗のタスク） */
export interface TaskRunInput {
  weight: TaskWeight;
  profileId: string | null;
}

/** 対象modの設定のうち、画面から変えられるもの */
export interface ProjectPatch {
  name?: string;
  readOnlyConcurrency?: number;
  editConcurrency?: number;
  weightProfiles?: WeightProfiles;
}

/** 画面から Bridge への操作 */
export interface BridgeApi {
  getSnapshot(): Promise<BridgeSnapshot>;
  getProgressEvents(owner: ProgressOwner): Promise<ProgressEvent[]>;

  /** フォルダーを選ぶダイアログを開く。キャンセルしたら null */
  pickProjectDirectory(): Promise<string | null>;
  addProject(rootPath: string): Promise<Project>;
  updateProject(projectId: string, patch: ProjectPatch): Promise<void>;

  /** 目標を作り、計画の作成を始める */
  createGoal(
    projectId: string,
    text: string,
    options: RunOptions,
  ): Promise<Goal>;
  /** 失敗した計画の作成をやり直す */
  retryPlan(goalId: string): Promise<void>;
  /** 指示を足して計画を作り直す */
  regeneratePlan(goalId: string, instruction: string): Promise<void>;
  addPlanTask(goalId: string, input: PlanTaskInput): Promise<void>;
  updatePlanTask(taskId: string, input: PlanTaskInput): Promise<void>;
  removePlanTask(taskId: string): Promise<void>;
  /** 計画を承認して、タスクの実行を始める */
  approvePlan(goalId: string): Promise<void>;
  /** 確認中・完了の目標に修正を指示する（修正のタスクを追加して実行する） */
  sendGoalInstruction(goalId: string, text: string): Promise<void>;
  /** 確認中の目標を完了にする */
  markGoalDone(goalId: string): Promise<void>;
  /** 反映待ちの目標を、ゲームを起動するディレクトリに反映し直す */
  integrateGoal(goalId: string): Promise<void>;

  /** タスクに追加で指示する */
  sendTaskInstruction(taskId: string, text: string): Promise<void>;
  /** 実行中のタスクを中止し、未着手に戻す */
  cancelTask(taskId: string): Promise<void>;
  /** 中止したタスクを自動実行の対象に戻す */
  resumeTask(taskId: string): Promise<void>;
  /** 失敗したタスクを未着手に戻す */
  retryTask(taskId: string): Promise<void>;
  /** 実行していないタスクの重さと実行の設定を変える */
  updateTaskRun(taskId: string, input: TaskRunInput): Promise<void>;

  /** 相談を作り、最初の質問を送る */
  createConsult(
    projectId: string,
    text: string,
    options: RunOptions,
  ): Promise<Consult>;
  sendConsultMessage(consultId: string, text: string): Promise<void>;
  cancelConsult(consultId: string): Promise<void>;

  respondApproval(
    approvalId: string,
    response: ApprovalResponse,
  ): Promise<void>;
  /** すべての実行と順番待ちを中止する */
  cancelAll(): Promise<void>;

  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** プロバイダーの状態（ログインなど）を確かめ直す */
  refreshProviders(): Promise<void>;
}

/** {@link BridgeApi} のメソッド名の一覧。preload と main がこの順に登録する */
export const BRIDGE_API_METHODS = [
  'getSnapshot',
  'getProgressEvents',
  'pickProjectDirectory',
  'addProject',
  'updateProject',
  'createGoal',
  'retryPlan',
  'regeneratePlan',
  'addPlanTask',
  'updatePlanTask',
  'removePlanTask',
  'approvePlan',
  'sendGoalInstruction',
  'markGoalDone',
  'integrateGoal',
  'sendTaskInstruction',
  'cancelTask',
  'resumeTask',
  'retryTask',
  'updateTaskRun',
  'createConsult',
  'sendConsultMessage',
  'cancelConsult',
  'respondApproval',
  'cancelAll',
  'updateSettings',
  'refreshProviders',
] as const satisfies readonly (keyof BridgeApi)[];

// 一覧の書き忘れを型で検出する（足りないメソッドがあると、ここがコンパイルエラーになる）
type MissingMethods = Exclude<
  keyof BridgeApi,
  (typeof BRIDGE_API_METHODS)[number]
>;
const assertAllMethodsListed: [MissingMethods] extends [never] ? true : never =
  true;
void assertAllMethodsListed;

/** IPC のチャンネル名（操作） */
export const invokeChannel = (method: keyof BridgeApi): string =>
  `bridge:${method}`;

/** AI の発言をストリームで表示するための、途中までの文章 */
export interface StreamingText {
  owner: ProgressOwner;
  /** 発言の ID。同じ発言の続きは同じ ID で届く */
  itemId: string;
  /** その時点までの全文 */
  text: string;
}

/** トレイのメニューや通知など、main から画面に頼む操作 */
export type UiCommand =
  | { type: 'openSettings' }
  /** 承認待ちを開く。projectId が null なら、いちばん古い承認待ちの対象modを開く */
  | { type: 'showApprovals'; projectId: string | null }
  /** 目標を開く。taskId があれば、そのタスクの詳細も開く */
  | {
      type: 'showGoal';
      projectId: string;
      goalId: string;
      taskId: string | null;
    };

/** main から画面へのプッシュ */
export interface BridgeEvents {
  /** 状態が変わった（まとめて送る） */
  snapshot: BridgeSnapshot;
  /** 途中経過が1件増えた */
  progress: ProgressEvent;
  /** AI の発言の途中経過 */
  streaming: StreamingText;
  uiCommand: UiCommand;
}

export type BridgeEventName = keyof BridgeEvents;

/** IPC のチャンネル名（プッシュ） */
export const eventChannel = (event: BridgeEventName): string =>
  `bridge-event:${event}`;

export const BRIDGE_EVENT_NAMES = [
  'snapshot',
  'progress',
  'streaming',
  'uiCommand',
] as const satisfies readonly BridgeEventName[];

/** preload が画面に公開する `window.bridge` の型 */
export interface BridgeClient extends BridgeApi {
  /** プッシュを購読する。戻り値の関数で購読をやめる */
  on<E extends BridgeEventName>(
    event: E,
    listener: (payload: BridgeEvents[E]) => void,
  ): () => void;
}
