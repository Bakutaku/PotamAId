/**
 * PotamAId Bridge の本体（仕様書5章）。
 *
 * 目標・タスク・相談の管理、実行順の管理、承認の管理を担い、変更をイベントで知らせる。
 * Electron に依存しないため、将来 Mod との WebSocket からも同じ操作を使える。
 * 画面からの操作は {@link BridgeApi} と同じ形のメソッドで受け付ける。
 */
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';
import type {
  ApprovalResponse,
  Consult,
  Goal,
  ProgressEvent,
  ProgressOwner,
  Project,
  ProviderStatus,
  RunOptions,
  Settings,
} from '../shared/domain';
import type {
  BridgeApi,
  BridgeSnapshot,
  PlanTaskInput,
  ProjectPatch,
} from '../shared/ipc';
import { ApprovalBroker } from './ApprovalBroker';
import { TypedEmitter } from './events';
import { checkTaskGraph } from './planning/taskGraph';
import type { AiProvider } from './providers/AiProvider';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { ConsultRunner, consultRunKey } from './runners/ConsultRunner';
import { PlanRunner, planRunKey } from './runners/PlanRunner';
import type { PlanRequest } from './runners/PlanRunner';
import { RunnerContext } from './runners/RunnerContext';
import type { CoreEvents } from './runners/RunnerContext';
import { TaskRunner, taskRunKey } from './runners/TaskRunner';
import { Scheduler } from './scheduler/Scheduler';
import { selectNextTask } from './scheduler/selectNextTask';
import { BridgeStore } from './store/BridgeStore';

/** Bridge の本体が受け付ける操作（画面のダイアログなど Electron の機能を除く） */
export type CoreApi = Omit<BridgeApi, 'pickProjectDirectory'>;

export interface BridgeCoreOptions {
  /** データベースのファイルのパス */
  databasePath: string;
  /** プロバイダーを作る。設定は呼び出すたびに最新のものを返す */
  createProviders(getSettings: () => Settings): AiProvider[];
  /** 想定外のエラーの記録先 */
  onError?(error: unknown): void;
}

/** 読み取り専用の同時実行数の初期値と範囲 */
const DEFAULT_READ_ONLY_CONCURRENCY = 2;
const MAX_READ_ONLY_CONCURRENCY = 8;
/** 題名に使う依頼文の長さ */
const TITLE_MAX_LENGTH = 30;
/** 終了時に、実行中のものが片付くのを待つ時間 */
const SHUTDOWN_TIMEOUT_MS = 3000;

export class BridgeCore implements CoreApi {
  readonly events = new TypedEmitter<CoreEvents>();

  private readonly store: BridgeStore;
  private readonly providers: ProviderRegistry;
  private readonly broker = new ApprovalBroker();
  private readonly ctx: RunnerContext;
  private readonly scheduler: Scheduler;
  private readonly planRunner: PlanRunner;
  private readonly taskRunner: TaskRunner;
  private readonly consultRunner: ConsultRunner;
  private settings: Settings;
  private providerStatuses: ProviderStatus[] = [];

  constructor(private readonly options: BridgeCoreOptions) {
    this.store = new BridgeStore(options.databasePath);
    this.settings = this.store.settings.load();
    this.providers = new ProviderRegistry(
      options.createProviders(() => this.settings),
    );
    this.ctx = new RunnerContext(
      this.store,
      this.providers,
      this.broker,
      this.events,
    );
    this.planRunner = new PlanRunner(this.ctx);
    this.taskRunner = new TaskRunner(this.ctx);
    this.consultRunner = new ConsultRunner(this.ctx);
    this.scheduler = new Scheduler({
      projectIds: () => this.store.projects.list().map((p) => p.id),
      readOnlyLimit: (projectId) =>
        this.store.projects.find(projectId)?.readOnlyConcurrency ??
        DEFAULT_READ_ONLY_CONCURRENCY,
      nextEditTask: (projectId) => {
        const goals = this.store.goals
          .list()
          .filter((g) => g.projectId === projectId);
        const goalIds = new Set(goals.map((g) => g.id));
        const tasks = this.store.tasks
          .list()
          .filter((t) => goalIds.has(t.goalId));
        return selectNextTask(goals, tasks);
      },
      runEditTask: (task) => this.taskRunner.run(task.id),
      onChange: () => this.ctx.changed(),
      onError: (error) => this.reportError(error),
    });
    this.recoverInterruptedWork();
  }

  /** プロバイダーの状態を確かめ、実行できるものを始める */
  start(): void {
    void this.refreshProviders();
    this.scheduler.pump();
  }

  // ---- 状態の取得 ----

  async getSnapshot(): Promise<BridgeSnapshot> {
    return this.snapshot();
  }

  snapshot(): BridgeSnapshot {
    const projects = this.store.projects.list();
    return {
      projects,
      goals: this.store.goals.list(),
      tasks: this.store.tasks.list(),
      consults: this.store.consults.list(),
      approvals: this.broker.list(),
      runs: Object.fromEntries(
        projects.map((p) => [p.id, this.scheduler.counts(p.id)]),
      ),
      settings: this.settings,
      providers: this.providerStatuses,
    };
  }

  async getProgressEvents(owner: ProgressOwner): Promise<ProgressEvent[]> {
    return this.store.events.listByOwner(owner);
  }

  /** 実行中か順番待ちのものがあるか */
  hasActiveWork(): boolean {
    return this.scheduler.hasActiveWork();
  }

  // ---- 対象mod ----

  async addProject(rootPath: string): Promise<Project> {
    const resolved = path.resolve(rootPath);
    if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error('フォルダーが見つかりません');
    }
    const existing = this.store.projects.findByRootPath(resolved);
    if (existing) {
      return existing;
    }
    const project: Project = {
      id: randomUUID(),
      name: path.basename(resolved),
      rootPath: resolved,
      readOnlyConcurrency: DEFAULT_READ_ONLY_CONCURRENCY,
      createdAt: Date.now(),
    };
    this.store.projects.insert(project);
    this.ctx.changed();
    return project;
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<void> {
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) {
      throw new Error('名前を入力してください');
    }
    const concurrency =
      patch.readOnlyConcurrency === undefined
        ? undefined
        : Math.min(
            MAX_READ_ONLY_CONCURRENCY,
            Math.max(1, Math.round(patch.readOnlyConcurrency)),
          );
    this.store.projects.update(projectId, {
      name,
      readOnlyConcurrency: concurrency,
    });
    this.ctx.changed();
    this.scheduler.pump();
  }

  // ---- 目標と計画 ----

  async createGoal(
    projectId: string,
    text: string,
    options: RunOptions,
  ): Promise<Goal> {
    const body = requireText(text, '目標を入力してください');
    if (!this.store.projects.find(projectId)) {
      throw new Error('対象modが見つかりません');
    }
    const goal: Goal = {
      id: randomUUID(),
      projectId,
      title: toTitle(body),
      text: body,
      status: 'planning',
      planSummary: null,
      planError: null,
      providerId: this.providers.defaultId,
      ...normalizeRunOptions(options),
      createdAt: Date.now(),
    };
    this.store.goals.insert(goal);
    this.ctx.record({ type: 'goal', id: goal.id }, 'user', body);
    this.enqueuePlan(goal, { kind: 'initial' });
    return goal;
  }

  async retryPlan(goalId: string): Promise<void> {
    const goal = this.store.goals.get(goalId);
    if (goal.status !== 'planFailed') {
      throw new Error('計画の作成に失敗した目標だけやり直せます');
    }
    this.store.goals.setPlanSessionId(goalId, null);
    this.enqueuePlan(goal, { kind: 'initial' });
  }

  async regeneratePlan(goalId: string, instruction: string): Promise<void> {
    const body = requireText(instruction, '指示を入力してください');
    const goal = this.store.goals.get(goalId);
    if (goal.status !== 'planReview') {
      throw new Error('計画の確認中の目標だけ作り直せます');
    }
    this.ctx.record({ type: 'goal', id: goalId }, 'user', body);
    this.enqueuePlan(goal, { kind: 'replan', instruction: body });
  }

  async addPlanTask(goalId: string, input: PlanTaskInput): Promise<void> {
    this.requirePlanReview(goalId);
    const tasks = this.store.tasks.listByGoal(goalId);
    this.store.tasks.insert(
      {
        id: randomUUID(),
        goalId,
        number: tasks.length + 1,
        title: requireText(input.title, '題名を入力してください'),
        description: input.description.trim(),
        status: 'todo',
        latest: null,
        result: null,
        needsGameRestart: false,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      filterDependencies(input.dependsOn, tasks, null),
    );
    this.ctx.changed();
  }

  async updatePlanTask(taskId: string, input: PlanTaskInput): Promise<void> {
    const task = this.store.tasks.get(taskId);
    this.requirePlanReview(task.goalId);
    const tasks = this.store.tasks.listByGoal(task.goalId);
    this.store.transaction(() => {
      this.store.tasks.update(taskId, {
        title: requireText(input.title, '題名を入力してください'),
        description: input.description.trim(),
      });
      this.store.tasks.setDependencies(
        taskId,
        filterDependencies(input.dependsOn, tasks, taskId),
      );
    });
    this.ctx.changed();
  }

  async removePlanTask(taskId: string): Promise<void> {
    const task = this.store.tasks.get(taskId);
    this.requirePlanReview(task.goalId);
    // 依存関係は外部キーの ON DELETE CASCADE で一緒に消える
    this.store.transaction(() => {
      this.store.tasks.delete(taskId);
      this.store.tasks.renumber(task.goalId);
    });
    this.ctx.changed();
  }

  async approvePlan(goalId: string): Promise<void> {
    this.requirePlanReview(goalId);
    if (this.scheduler.has(planRunKey(goalId))) {
      throw new Error('計画を作り直している間は承認できません');
    }
    const tasks = this.store.tasks.listByGoal(goalId);
    if (tasks.length === 0) {
      throw new Error('タスクがありません');
    }
    const numberOf = new Map(tasks.map((t) => [t.id, `#${t.number}`]));
    const check = checkTaskGraph(tasks, (id) => numberOf.get(id) ?? id);
    if (!check.ok) {
      throw new Error(check.error);
    }
    this.store.goals.setStatus(goalId, 'active');
    this.ctx.record(
      { type: 'goal', id: goalId },
      'system',
      '計画を承認しました',
    );
    this.ctx.changed();
    this.scheduler.pump();
  }

  // ---- タスク ----

  async sendTaskInstruction(taskId: string, text: string): Promise<void> {
    const body = requireText(text, '指示を入力してください');
    const task = this.store.tasks.get(taskId);
    if (this.store.goals.get(task.goalId).status !== 'active') {
      throw new Error('計画を承認してから指示してください');
    }
    this.store.tasks.addInstruction(taskId, body, Date.now());
    // 失敗時に残した未送信の指示だけでは自動再試行しない。新しい指示は明示的な再開として扱う。
    if (task.status === 'failed') {
      this.store.tasks.update(taskId, { status: 'todo', error: null });
    }
    this.ctx.changed();
    // 確認待ち・完了・失敗のタスクは、空いていればすぐに続きを実行する
    this.scheduler.pump();
  }

  async markTaskDone(taskId: string): Promise<void> {
    const task = this.store.tasks.get(taskId);
    if (task.status !== 'review') {
      throw new Error('確認待ちのタスクだけ完了にできます');
    }
    this.store.tasks.update(taskId, { status: 'done', latest: null });
    this.ctx.record({ type: 'task', id: taskId }, 'system', '完了にしました');
    this.ctx.changed();
    this.scheduler.pump();
  }

  async cancelTask(taskId: string): Promise<void> {
    this.broker.cancelForOwner({ type: 'task', id: taskId });
    if (!this.ctx.requestCancel(taskRunKey(taskId))) {
      throw new Error('このタスクは実行していません');
    }
  }

  async retryTask(taskId: string): Promise<void> {
    const task = this.store.tasks.get(taskId);
    if (task.status !== 'failed') {
      throw new Error('失敗したタスクだけやり直せます');
    }
    this.store.tasks.update(taskId, { error: null });
    this.taskRunner.resetToTodo(taskId, 'やり直します。未着手に戻しました。');
    this.scheduler.pump();
  }

  // ---- 相談 ----

  async createConsult(
    projectId: string,
    text: string,
    options: RunOptions,
  ): Promise<Consult> {
    const body = requireText(text, '相談の内容を入力してください');
    if (!this.store.projects.find(projectId)) {
      throw new Error('対象modが見つかりません');
    }
    const now = Date.now();
    const consult: Consult = {
      id: randomUUID(),
      projectId,
      title: toTitle(body),
      providerId: this.providers.defaultId,
      ...normalizeRunOptions(options),
      status: 'queued',
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.consults.insert(consult);
    this.enqueueConsult(consult, body);
    return consult;
  }

  async sendConsultMessage(consultId: string, text: string): Promise<void> {
    const body = requireText(text, '内容を入力してください');
    const consult = this.store.consults.get(consultId);
    if (consult.status === 'running' || consult.status === 'queued') {
      throw new Error('応答が終わってから送ってください');
    }
    this.store.consults.setStatus(consultId, 'queued', null, Date.now());
    this.enqueueConsult(consult, body);
  }

  async cancelConsult(consultId: string): Promise<void> {
    const key = consultRunKey(consultId);
    if (this.scheduler.dequeue(key)) {
      return;
    }
    this.broker.cancelForOwner({ type: 'consult', id: consultId });
    if (!this.ctx.requestCancel(key)) {
      throw new Error('この相談は実行していません');
    }
  }

  // ---- 承認・全体 ----

  async respondApproval(
    approvalId: string,
    response: ApprovalResponse,
  ): Promise<void> {
    if (!this.broker.respond(approvalId, response)) {
      throw new Error('この承認はすでに回答済みです');
    }
    this.ctx.changed();
  }

  async cancelAll(): Promise<void> {
    this.scheduler.clearQueue();
    this.broker.cancelAll();
    this.ctx.cancelAllRuns();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const before = this.settings;
    this.store.settings.save(normalizeSettings(patch));
    this.settings = this.store.settings.load();
    this.ctx.changed();
    // モデル・思考量・タイムアウトは次の実行から使われる。実行ファイルが変わったときだけ起動し直す
    if (before.codexPath !== this.settings.codexPath) {
      await this.providers.disposeAll();
      await this.refreshProviders();
    }
  }

  async refreshProviders(): Promise<void> {
    this.providerStatuses = this.providerStatuses.map((s) => ({
      ...s,
      state: s.state === 'notSupported' ? s.state : 'checking',
    }));
    this.ctx.changed();
    this.providerStatuses = await this.providers.statuses();
    this.ctx.changed();
  }

  /** 終了する。実行中のものは止め、次の起動で中断として扱う */
  async shutdown(): Promise<void> {
    this.ctx.closing = true;
    this.scheduler.clearQueue();
    await this.providers.disposeAll();
    await this.scheduler.stop(SHUTDOWN_TIMEOUT_MS);
    this.store.close();
  }

  // ---- 内部の処理 ----

  private enqueuePlan(goal: Goal, request: PlanRequest): void {
    this.store.goals.setStatus(goal.id, 'planning');
    this.scheduler.enqueue({
      key: planRunKey(goal.id),
      projectId: goal.projectId,
      run: () => this.planRunner.run(goal.id, request),
      onDequeued: () =>
        this.planRunner.fail(goal.id, '計画の作成を中止しました'),
    });
    this.ctx.changed();
  }

  private enqueueConsult(consult: Consult, text: string): void {
    const owner: ProgressOwner = { type: 'consult', id: consult.id };
    this.ctx.record(owner, 'user', text);
    this.scheduler.enqueue({
      key: consultRunKey(consult.id),
      projectId: consult.projectId,
      run: () => this.consultRunner.run(consult.id, text),
      onDequeued: () => {
        this.ctx.record(owner, 'system', '中止しました');
        this.store.consults.setStatus(consult.id, 'idle', null, Date.now());
      },
    });
    this.ctx.changed();
  }

  private requirePlanReview(goalId: string): void {
    if (this.store.goals.get(goalId).status !== 'planReview') {
      throw new Error('計画の確認中の目標だけ編集できます');
    }
  }

  /**
   * 前回の終了で中断したものを片付ける。
   * 実行中だったタスク・相談は中止と同じ扱いにし、自動では再開しない。
   */
  private recoverInterruptedWork(): void {
    const message = '前回の Bridge の終了で中断しました';
    for (const task of this.store.tasks.listByStatus(['running', 'approval'])) {
      this.taskRunner.resetToTodo(task.id, `${message}。未着手に戻しました。`);
    }
    for (const id of this.store.consults.resetStatuses(
      ['running', 'queued'],
      'idle',
      Date.now(),
    )) {
      this.ctx.record({ type: 'consult', id }, 'system', message);
    }
    for (const goal of this.store.goals.list()) {
      if (goal.status === 'planning') {
        this.planRunner.fail(goal.id, message);
      }
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }
}

/** モデルと思考量の空の指定は、設定の既定（null）として扱う */
function normalizeRunOptions(options: RunOptions | undefined): RunOptions {
  return {
    model: options?.model?.trim() || null,
    effort: options?.effort?.trim() || null,
  };
}

/** タイムアウトの範囲（秒・分） */
const TIMEOUT_LIMITS = {
  requestTimeoutSeconds: { min: 5, max: 600 },
  turnIdleTimeoutMinutes: { min: 1, max: 240 },
} as const;

/** 設定の数値を範囲に収める */
function normalizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const result = { ...patch };
  for (const key of Object.keys(
    TIMEOUT_LIMITS,
  ) as (keyof typeof TIMEOUT_LIMITS)[]) {
    const value = result[key];
    if (value !== undefined) {
      const { min, max } = TIMEOUT_LIMITS[key];
      result[key] = Math.min(
        max,
        Math.max(min, Math.round(Number(value) || min)),
      );
    }
  }
  return result;
}

/** 前後の空白を除き、空なら例外 */
function requireText(text: string, message: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

/** 依頼文の1行目から題名を作る */
function toTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH)}…`
    : firstLine;
}

/** 同じ目標のタスクで、自分以外への依存だけを残す */
function filterDependencies(
  dependsOn: string[],
  goalTasks: { id: string }[],
  selfId: string | null,
): string[] {
  const ids = new Set(goalTasks.map((t) => t.id));
  return dependsOn.filter((id) => ids.has(id) && id !== selfId);
}
