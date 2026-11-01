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
  ExecutionProfile,
  Goal,
  GoalStatus,
  ProgressEvent,
  ProgressOwner,
  Project,
  ProviderStatus,
  RunOptions,
  Settings,
  Task,
  TaskKind,
  WeightProfiles,
} from '../shared/domain';
import { TASK_WEIGHTS } from '../shared/domain';
import { isGoalWorkFinished } from '../shared/goals';
import type {
  BridgeApi,
  BridgeSnapshot,
  PlanTaskInput,
  ProjectPatch,
  TaskRunInput,
} from '../shared/ipc';
import { findProfile, normalizeWeight } from '../shared/runConfig';
import { ApprovalBroker } from './ApprovalBroker';
import { BridgeMcpServer } from './mcp/BridgeMcpServer';
import { TypedEmitter } from './events';
import { GoalWorkspaces } from './git/GoalWorkspaces';
import { checkTaskGraph } from './planning/taskGraph';
import type { AiProvider } from './providers/AiProvider';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { ConsultRunner, consultRunKey } from './runners/ConsultRunner';
import { GoalIntegrator } from './runners/GoalIntegrator';
import { PlanRunner, planRunKey } from './runners/PlanRunner';
import type { PlanRequest } from './runners/PlanRunner';
import { RunnerContext } from './runners/RunnerContext';
import type { CoreEvents } from './runners/RunnerContext';
import { TaskRunner, taskRunKey } from './runners/TaskRunner';
import { Scheduler } from './scheduler/Scheduler';
import {
  selectNextEditTask,
  selectNextInvestigateTask,
} from './scheduler/selectNextTask';
import { BridgeStore } from './store/BridgeStore';

/** Bridge の本体が受け付ける操作（画面のダイアログなど Electron の機能を除く） */
export type CoreApi = Omit<BridgeApi, 'pickProjectDirectory'>;

export interface BridgeCoreOptions {
  /** データベースのファイルのパス */
  databasePath: string;
  /** 目標の worktree を置くディレクトリ（Bridge のユーザーデータの worktrees。2026-10-25 決定） */
  worktreesDir: string;
  /** プロバイダーを作る。設定は呼び出すたびに最新のものを返す */
  createProviders(getSettings: () => Settings): AiProvider[];
  /** 想定外のエラーの記録先 */
  onError?(error: unknown): void;
}

/** 読み取り専用の同時実行数の初期値と範囲 */
const DEFAULT_READ_ONLY_CONCURRENCY = 2;
const MAX_READ_ONLY_CONCURRENCY = 8;
/** 編集タスクの同時実行数の初期値（並行しない）と上限 */
const DEFAULT_EDIT_CONCURRENCY = 1;
const MAX_EDIT_CONCURRENCY = 8;
/** 題名に使う依頼文の長さ */
const TITLE_MAX_LENGTH = 30;
/** 終了時に、実行中のものが片付くのを待つ時間 */
const SHUTDOWN_TIMEOUT_MS = 3000;

export class BridgeCore implements CoreApi {
  readonly events = new TypedEmitter<CoreEvents>();

  private readonly store: BridgeStore;
  private readonly providers: ProviderRegistry;
  private readonly broker = new ApprovalBroker();
  private readonly mcp: BridgeMcpServer;
  private readonly ctx: RunnerContext;
  private readonly scheduler: Scheduler;
  private readonly planRunner: PlanRunner;
  private readonly taskRunner: TaskRunner;
  private readonly consultRunner: ConsultRunner;
  private readonly workspaces: GoalWorkspaces;
  private readonly integrator: GoalIntegrator;
  /** worktree を作っている目標（承認の二重実行を防ぐ） */
  private readonly approving = new Set<string>();
  private settings: Settings;
  private providerStatuses: ProviderStatus[] = [];

  constructor(private readonly options: BridgeCoreOptions) {
    this.store = new BridgeStore(options.databasePath);
    this.settings = this.store.settings.load();
    this.providers = new ProviderRegistry(
      options.createProviders(() => this.settings),
    );
    this.mcp = new BridgeMcpServer(this.store, (error) =>
      this.reportError(error),
    );
    this.ctx = new RunnerContext(
      this.store,
      this.providers,
      this.broker,
      this.events,
      this.mcp,
      () => this.settings,
    );
    this.planRunner = new PlanRunner(this.ctx);
    this.workspaces = new GoalWorkspaces(options.worktreesDir);
    this.integrator = new GoalIntegrator(
      this.ctx,
      this.workspaces,
      () => this.scheduler.pump(),
      (error) => this.reportError(error),
    );
    this.taskRunner = new TaskRunner(
      this.ctx,
      this.workspaces,
      this.integrator,
    );
    this.consultRunner = new ConsultRunner(this.ctx);
    this.scheduler = new Scheduler({
      projectIds: () => this.store.projects.list().map((p) => p.id),
      readOnlyLimit: (projectId) =>
        this.store.projects.find(projectId)?.readOnlyConcurrency ??
        DEFAULT_READ_ONLY_CONCURRENCY,
      editLimit: (projectId) =>
        this.store.projects.find(projectId)?.editConcurrency ??
        DEFAULT_EDIT_CONCURRENCY,
      nextEditTask: (projectId, running) => {
        const { goals, tasks } = this.projectWork(projectId);
        return selectNextEditTask(goals, tasks, running);
      },
      runEditTask: (task) => this.taskRunner.run(task.id),
      nextInvestigateTask: (projectId, running) => {
        const { goals, tasks } = this.projectWork(projectId);
        return selectNextInvestigateTask(goals, tasks, running);
      },
      runInvestigateTask: (task) => this.taskRunner.run(task.id),
      onChange: () => this.ctx.changed(),
      onError: (error) => this.reportError(error),
    });
    this.recoverInterruptedWork();
  }

  /** プロバイダーの状態を確かめ、実行できるものを始める */
  start(): void {
    // セッションを始めるときにも待つので、ここでは待ち受けの開始だけを先に頼む
    this.mcp.start().catch((error: unknown) => this.reportError(error));
    void this.refreshProviders();
    this.scheduler.pump();
    this.resumeIntegrations();
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
      editConcurrency: DEFAULT_EDIT_CONCURRENCY,
      weightProfiles: {},
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
      editConcurrency:
        patch.editConcurrency === undefined
          ? undefined
          : clamp(patch.editConcurrency, 1, MAX_EDIT_CONCURRENCY),
      weightProfiles:
        patch.weightProfiles && normalizeWeightProfiles(patch.weightProfiles),
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
      branch: null,
      baseBranch: null,
      worktreePath: null,
      workDir: null,
      waitReason: null,
      roundStartedAt: null,
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
        kind: normalizeKind(input.kind),
        ...this.normalizeTaskRun(input),
        runInfo: null,
        status: 'todo',
        paused: false,
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
        kind: normalizeKind(input.kind),
        ...this.normalizeTaskRun(input),
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
    if (this.approving.has(goalId)) {
      throw new Error('承認の処理中です');
    }
    // 編集タスクは目標の worktree で実行する（仕様書3章「worktree での並行実行」）。
    // git のリポジトリでなければ承認しない（2026-10-25 決定）
    const goal = this.store.goals.get(goalId);
    const project = this.requireProject(goal.projectId);
    this.approving.add(goalId);
    try {
      const worktree = await this.workspaces.create(
        project.id,
        project.rootPath,
        goalId,
      );
      this.requirePlanReview(goalId);
      this.store.transaction(() => {
        this.store.goals.setWorktree(goalId, worktree);
        this.store.goals.setStatus(goalId, 'active');
        this.store.goals.setRoundStartedAt(goalId, Date.now());
      });
      this.ctx.record(
        { type: 'goal', id: goalId },
        'system',
        `計画を承認しました。${worktree.baseBranch} から目標のブランチ ${worktree.branch} を作り、worktree で実行します`,
        worktree.worktreePath,
      );
    } finally {
      this.approving.delete(goalId);
    }
    this.ctx.changed();
    this.scheduler.pump();
  }

  // ---- 目標の確認 ----

  async sendGoalInstruction(goalId: string, text: string): Promise<void> {
    const body = requireText(text, '指示を入力してください');
    const goal = this.store.goals.get(goalId);
    if (
      goal.status !== 'review' &&
      goal.status !== 'done' &&
      goal.status !== 'waiting'
    ) {
      throw new Error('反映待ち・確認中・完了の目標だけ修正を指示できます');
    }
    const tasks = this.store.tasks.listByGoal(goalId);
    const taskId = randomUUID();
    this.store.transaction(() => {
      this.startRoundIfIdle(goal, tasks);
      // 修正はそれまでのタスクすべての後に実行し、その結果を添える
      this.store.tasks.insert(
        {
          id: taskId,
          goalId,
          number: tasks.length + 1,
          title: `修正: ${toTitle(body)}`,
          description: body,
          kind: 'edit',
          // 修正は AI が重さを付けないため、標準にする（2026-10-25 決定）
          weight: 'standard',
          profileId: null,
          runInfo: null,
          status: 'todo',
          paused: false,
          latest: null,
          result: null,
          needsGameRestart: false,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
        tasks.map((t) => t.id),
      );
    });
    this.ctx.record({ type: 'task', id: taskId }, 'user', body);
    this.ctx.changed();
    this.scheduler.pump();
  }

  async markGoalDone(goalId: string): Promise<void> {
    const goal = this.store.goals.get(goalId);
    if (goal.status !== 'review') {
      throw new Error('確認中の目標だけ完了にできます');
    }
    if (!isGoalWorkFinished(this.store.tasks.listByGoal(goalId))) {
      throw new Error('すべてのタスクが終わってから完了にしてください');
    }
    this.store.goals.setStatus(goalId, 'done');
    this.ctx.record({ type: 'goal', id: goalId }, 'system', '完了にしました');
    this.ctx.changed();
    this.scheduler.pump();
    // 完了にした目標の worktree は消し、ブランチは残す（2026-10-25 決定）
    if (goal.worktreePath) {
      await this.removeWorktree(goal);
    }
    // 確認が終わったので、反映待ちの目標を反映する
    void this.integrator.requestWaiting(goal.projectId);
  }

  async integrateGoal(goalId: string): Promise<void> {
    const goal = this.store.goals.get(goalId);
    if (goal.status !== 'waiting') {
      throw new Error('反映待ちの目標だけ反映できます');
    }
    await this.integrator.request(goalId);
    const after = this.store.goals.get(goalId);
    if (after.status === 'waiting' && after.waitReason) {
      throw new Error(after.waitReason);
    }
  }

  // ---- タスク ----

  async sendTaskInstruction(taskId: string, text: string): Promise<void> {
    const body = requireText(text, '指示を入力してください');
    if (this.ctx.isCancelRequested(taskRunKey(taskId))) {
      throw new Error('中止の処理が終わってから指示してください');
    }
    const task = this.store.tasks.get(taskId);
    const goal = this.store.goals.get(task.goalId);
    if (!INSTRUCTABLE_GOALS.includes(goal.status)) {
      throw new Error('計画を承認してから指示してください');
    }
    this.store.transaction(() => {
      this.startRoundIfIdle(goal, this.store.tasks.listByGoal(goal.id));
      this.store.tasks.addInstruction(taskId, body, Date.now());
      this.store.tasks.update(taskId, { paused: false });
      // 失敗時に残した未送信の指示だけでは自動再試行しない。新しい指示は明示的な再開として扱う。
      if (task.status === 'failed') {
        this.store.tasks.update(taskId, { status: 'todo', error: null });
      }
    });
    this.ctx.changed();
    // 完了・失敗のタスクは、空いていればすぐに続きを実行する
    this.scheduler.pump();
  }

  async cancelTask(taskId: string): Promise<void> {
    if (!this.ctx.requestCancel(taskRunKey(taskId))) {
      throw new Error('このタスクは実行していません');
    }
    this.store.tasks.update(taskId, { paused: true });
    this.broker.cancelForOwner({ type: 'task', id: taskId });
    this.ctx.changed();
  }

  async resumeTask(taskId: string): Promise<void> {
    const task = this.store.tasks.get(taskId);
    const goal = this.store.goals.get(task.goalId);
    if (
      !task.paused ||
      (task.status !== 'todo' && task.status !== 'done') ||
      this.ctx.isRunning(taskRunKey(taskId)) ||
      !INSTRUCTABLE_GOALS.includes(goal.status)
    ) {
      throw new Error('停止中のタスクだけ再開できます');
    }
    this.store.tasks.update(taskId, { paused: false });
    this.ctx.record({ type: 'task', id: taskId }, 'system', '再開します');
    this.ctx.changed();
    this.scheduler.pump();
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

  async updateTaskRun(taskId: string, input: TaskRunInput): Promise<void> {
    const task = this.store.tasks.get(taskId);
    if (
      (task.status !== 'todo' && task.status !== 'failed') ||
      this.ctx.isRunning(taskRunKey(taskId))
    ) {
      throw new Error(
        '未着手か失敗のタスクだけ、重さと実行の設定を変えられます',
      );
    }
    this.store.tasks.update(taskId, this.normalizeTaskRun(input));
    this.ctx.changed();
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
    // 実行の終了で枠が空いても、待機中のタスクや追加の指示を自動で始めない。
    this.store.transaction(() => {
      const goals = new Set(
        this.store.goals
          .list()
          .filter((goal) => INSTRUCTABLE_GOALS.includes(goal.status))
          .map((goal) => goal.id),
      );
      for (const task of this.store.tasks.list()) {
        if (
          goals.has(task.goalId) &&
          (['todo', 'running', 'approval'].includes(task.status) ||
            (task.status === 'done' && task.pendingInstructions > 0))
        ) {
          this.store.tasks.update(task.id, { paused: true });
        }
      }
    });
    this.ctx.cancelAllRuns();
    this.scheduler.clearQueue();
    this.broker.cancelAll();
    this.ctx.changed();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const before = this.settings;
    const normalized = normalizeSettings(patch);
    // 消した実行の設定を既定にしていたら、既定を外す
    const profiles = normalized.profiles ?? before.profiles;
    const defaultId =
      normalized.defaultProfileId !== undefined
        ? normalized.defaultProfileId
        : before.defaultProfileId;
    if (defaultId && !profiles.some((p) => p.id === defaultId)) {
      normalized.defaultProfileId = null;
    }
    this.store.settings.save(normalized);
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
    await this.integrator.idle();
    await this.mcp.close();
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

  /** 対象modの目標（作成順）とそのタスク */
  private projectWork(projectId: string): { goals: Goal[]; tasks: Task[] } {
    const goals = this.store.goals
      .list()
      .filter((g) => g.projectId === projectId);
    const goalIds = new Set(goals.map((g) => g.id));
    const tasks = this.store.tasks.list().filter((t) => goalIds.has(t.goalId));
    return { goals, tasks };
  }

  /**
   * 確認中・完了の目標に新しい作業を足すとき、作業が残っていなければ新しい区切りを始める。
   * 完了にした目標は確認中に戻す。反映待ちの目標は、worktree で続けるため進行中に戻す。
   */
  private startRoundIfIdle(goal: Goal, tasks: Task[]): void {
    if (goal.status === 'waiting') {
      this.store.goals.setStatus(goal.id, 'active');
      this.store.goals.setWaitReason(goal.id, null);
      return;
    }
    if (goal.status !== 'review' && goal.status !== 'done') {
      return;
    }
    if (isGoalWorkFinished(tasks)) {
      this.store.goals.setRoundStartedAt(goal.id, Date.now());
    }
    if (goal.status === 'done') {
      this.store.goals.setStatus(goal.id, 'review');
    }
  }

  /** 画面から届いたタスクの重さと実行の設定。消えた実行の設定は指定なしにする */
  private normalizeTaskRun(input: TaskRunInput): TaskRunInput {
    return {
      weight: normalizeWeight(input.weight),
      profileId: findProfile(this.settings, input.profileId)?.id ?? null,
    };
  }

  private requireProject(projectId: string): Project {
    const project = this.store.projects.find(projectId);
    if (!project) {
      throw new Error('対象modが見つかりません');
    }
    return project;
  }

  /** 目標の worktree を消す。消せなくても完了の操作は失敗にしない */
  private async removeWorktree(goal: Goal): Promise<void> {
    const project = this.store.projects.find(goal.projectId);
    if (!project || !goal.worktreePath) {
      return;
    }
    try {
      await this.workspaces.remove(project.rootPath, goal.worktreePath);
      this.store.goals.setWorktree(goal.id, {
        branch: goal.branch,
        baseBranch: goal.baseBranch,
        worktreePath: null,
        workDir: null,
      });
      this.ctx.record(
        { type: 'goal', id: goal.id },
        'system',
        `worktree を消しました（ブランチ ${goal.branch} は残しています）`,
      );
    } catch (error) {
      this.ctx.record(
        { type: 'goal', id: goal.id },
        'error',
        `worktree を消せませんでした: ${error instanceof Error ? error.message : String(error)}`,
        goal.worktreePath,
      );
    }
    this.ctx.changed();
  }

  /**
   * 前回の終了で反映の途中だった目標と、反映待ちの目標の反映をやり直す
   * （タスクがすべて終わった進行中の目標は、反映の前に終了したもの）
   */
  private resumeIntegrations(): void {
    for (const goal of this.store.goals.list()) {
      if (goal.status === 'active' && goal.worktreePath) {
        void this.integrator.request(goal.id);
      }
    }
    for (const project of this.store.projects.list()) {
      void this.integrator.requestWaiting(project.id);
    }
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
      this.taskRunner.resetToTodo(
        task.id,
        `${message}。再開するまで停止します。`,
        true,
      );
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

/** タスクに追加で指示できる目標の状態（計画を承認したあと） */
const INSTRUCTABLE_GOALS: GoalStatus[] = [
  'active',
  'waiting',
  'review',
  'done',
];

/** 数値を整数にして範囲に収める */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

/** 画面から届いたタスクの種類。知らない値は編集タスクとして扱う */
function normalizeKind(kind: TaskKind | undefined): TaskKind {
  return kind === 'investigate' ? 'investigate' : 'edit';
}

/**
 * 実行の設定・モデル・思考量の空の指定は、設定の既定（null）として扱う。
 * 実行の設定を選んだときは、モデルと思考量を持たない
 */
function normalizeRunOptions(options: RunOptions | undefined): RunOptions {
  const profileId = options?.profileId?.trim() || null;
  return profileId
    ? { profileId, model: null, effort: null }
    : {
        profileId: null,
        model: options?.model?.trim() || null,
        effort: options?.effort?.trim() || null,
      };
}

/** 重さ → 実行の設定の対応から、知らない重さと空の指定を除く */
function normalizeWeightProfiles(map: WeightProfiles): WeightProfiles {
  return Object.fromEntries(
    TASK_WEIGHTS.flatMap((weight) => {
      const id = map[weight]?.trim();
      return id ? [[weight, id]] : [];
    }),
  );
}

/** 実行の設定を整える。名前は必須 */
function normalizeProfiles(profiles: ExecutionProfile[]): ExecutionProfile[] {
  return profiles.map((profile) => ({
    id: profile.id?.trim() || randomUUID(),
    name: requireText(profile.name ?? '', '実行の設定の名前を入力してください'),
    providerId: profile.providerId === 'claude' ? 'claude' : 'codex',
    model: profile.model?.trim() || null,
    effort: profile.effort?.trim() || null,
  }));
}

/** タイムアウトの範囲（秒・分） */
const TIMEOUT_LIMITS = {
  requestTimeoutSeconds: { min: 5, max: 600 },
  turnIdleTimeoutMinutes: { min: 1, max: 240 },
} as const;

/** 設定の数値を範囲に収める */
function normalizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const result = { ...patch };
  if (result.profiles !== undefined) {
    result.profiles = normalizeProfiles(result.profiles);
  }
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
