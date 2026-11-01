/**
 * AI の実行枠の管理（仕様書3章・5章）。
 *
 * - 編集タスクは、目標ごとの worktree で、対象modごとの上限まで並行して実行する（初期値は1）。
 *   実行するタスクは保存されている状態から {@link SchedulerHooks.nextEditTask} で選ぶ
 *   （同じ worktree の編集タスクは1件ずつにする）。
 * - 読み取り専用の実行（計画の作成・調査タスク・相談）は、対象modごとの上限まで並行して実行する。
 *   計画の作成と相談は順番待ち（FIFO）に入れ、空いた順に実行する。
 *   ユーザーが応答を待っているため、空いた枠には順番待ちを先に入れ、残りに調査タスクを入れる。
 *   調査タスクは、編集タスクと同じく保存されている状態から {@link SchedulerHooks.nextInvestigateTask} で選ぶ。
 */
import type { Task } from '../../shared/domain';
import type { RunCounts } from '../../shared/ipc';

/** 読み取り専用の実行の1件 */
export interface ReadOnlyJob {
  /** 同じものを二重に積まないための識別子（"plan:<goalId>" など） */
  key: string;
  projectId: string;
  run(): Promise<void>;
  /** 実行する前に順番待ちから外されたときに呼ばれる */
  onDequeued(): void;
}

export interface SchedulerHooks {
  projectIds(): string[];
  readOnlyLimit(projectId: string): number;
  editLimit(projectId: string): number;
  /**
   * 次に実行する編集タスク。なければ null
   * @param running 実行中の編集タスクの ID
   */
  nextEditTask(projectId: string, running: ReadonlySet<string>): Task | null;
  runEditTask(task: Task): Promise<void>;
  /**
   * 次に実行する調査タスク。なければ null
   * @param running 実行中の調査タスクの ID
   */
  nextInvestigateTask(
    projectId: string,
    running: ReadonlySet<string>,
  ): Task | null;
  runInvestigateTask(task: Task): Promise<void>;
  /** 実行の数が変わった */
  onChange(): void;
  onError(error: unknown): void;
}

export class Scheduler {
  private readonly queue: ReadOnlyJob[] = [];
  private readonly runningReadOnly = new Map<string, ReadOnlyJob>();
  /** 対象mod の ID → 実行中の編集タスクの ID */
  private readonly runningEdit = new Map<string, Set<string>>();
  /** 実行中の調査タスクの ID */
  private readonly runningInvestigations = new Set<string>();
  private readonly settled = new Set<Promise<void>>();
  private stopped = false;

  constructor(private readonly hooks: SchedulerHooks) {}

  /** 読み取り専用の実行を順番待ちに入れる */
  enqueue(job: ReadOnlyJob): void {
    if (this.has(job.key)) {
      throw new Error('すでに実行中か順番待ちです');
    }
    this.queue.push(job);
    this.pump();
  }

  /** 順番待ちから外す。外せたら true（実行中のものは外せない） */
  dequeue(key: string): boolean {
    const index = this.queue.findIndex((job) => job.key === key);
    if (index < 0) {
      return false;
    }
    const [job] = this.queue.splice(index, 1);
    job.onDequeued();
    this.hooks.onChange();
    return true;
  }

  /** 順番待ちをすべて外す */
  clearQueue(): void {
    for (const job of this.queue.splice(0)) {
      job.onDequeued();
    }
    this.hooks.onChange();
  }

  has(key: string): boolean {
    return (
      this.runningReadOnly.has(key) || this.queue.some((job) => job.key === key)
    );
  }

  isQueued(key: string): boolean {
    return this.queue.some((job) => job.key === key);
  }

  counts(projectId: string): RunCounts {
    return {
      edit: this.runningEdit.get(projectId)?.size ?? 0,
      editLimit: this.hooks.editLimit(projectId),
      readOnly: [...this.runningReadOnly.values()].filter(
        (job) => job.projectId === projectId,
      ).length,
      readOnlyLimit: this.hooks.readOnlyLimit(projectId),
      queued: this.queue.filter((job) => job.projectId === projectId).length,
    };
  }

  /** 実行中か順番待ちのものがあるか（終了の警告に使う） */
  hasActiveWork(): boolean {
    return (
      [...this.runningEdit.values()].some((set) => set.size > 0) ||
      this.runningReadOnly.size > 0 ||
      this.queue.length > 0
    );
  }

  /** 空いている枠に、実行できるものを入れる。状態が変わるたびに呼ぶ */
  pump(): void {
    if (this.stopped) {
      return;
    }
    for (const projectId of this.hooks.projectIds()) {
      this.pumpEdit(projectId);
      this.pumpReadOnly(projectId);
    }
  }

  /** 新しく始めるのをやめ、実行中のものが終わるのを待つ（最大 timeoutMs） */
  async stop(timeoutMs: number): Promise<void> {
    this.stopped = true;
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, timeoutMs),
    );
    await Promise.race([Promise.allSettled(this.settled), timeout]);
  }

  private pumpEdit(projectId: string): void {
    const running = this.runningEdit.get(projectId) ?? new Set<string>();
    this.runningEdit.set(projectId, running);
    while (running.size < this.hooks.editLimit(projectId)) {
      const task = this.hooks.nextEditTask(projectId, running);
      if (!task) {
        return;
      }
      running.add(task.id);
      this.track(this.hooks.runEditTask(task), () => {
        running.delete(task.id);
      });
    }
  }

  private pumpReadOnly(projectId: string): void {
    const limit = this.hooks.readOnlyLimit(projectId);
    while (this.counts(projectId).readOnly < limit) {
      const job = this.takeQueued(projectId) ?? this.investigateJob(projectId);
      if (!job) {
        return;
      }
      this.runningReadOnly.set(job.key, job);
      this.track(job.run(), () => {
        this.runningReadOnly.delete(job.key);
      });
    }
  }

  private takeQueued(projectId: string): ReadOnlyJob | null {
    const index = this.queue.findIndex((job) => job.projectId === projectId);
    return index < 0 ? null : (this.queue.splice(index, 1)[0] ?? null);
  }

  /** 次の調査タスクを、読み取り専用の実行の1件として返す */
  private investigateJob(projectId: string): ReadOnlyJob | null {
    const task = this.hooks.nextInvestigateTask(
      projectId,
      this.runningInvestigations,
    );
    if (!task) {
      return null;
    }
    this.runningInvestigations.add(task.id);
    return {
      key: `investigate:${task.id}`,
      projectId,
      run: () =>
        this.hooks.runInvestigateTask(task).finally(() => {
          this.runningInvestigations.delete(task.id);
        }),
      onDequeued: () => undefined,
    };
  }

  /** 実行の終わりを見届け、枠を空けて次を入れる */
  private track(promise: Promise<void>, release: () => void): void {
    this.hooks.onChange();
    const settled = promise
      .catch((error: unknown) => this.hooks.onError(error))
      .finally(() => {
        release();
        this.settled.delete(settled);
        this.hooks.onChange();
        this.pump();
      });
    this.settled.add(settled);
  }
}
