import { z } from 'zod';
import type { BridgeCore } from '../BridgeCore';
import type { Consult, Goal, ProgressOwner, Task } from '../../shared/domain';

const id = z.string().min(8).max(36);
const page = z.number().int().min(1).max(1_000_000).default(1);
const text = z.string().trim().min(1).max(2000);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('consult_list'), page }).strict(),
  z.object({ action: z.literal('consult_new'), text }).strict(),
  z.object({ action: z.literal('consult_select'), id }).strict(),
  z.object({ action: z.literal('consult_send'), text }).strict(),
  z.object({ action: z.literal('consult_cancel') }).strict(),
  z.object({ action: z.literal('goals'), page }).strict(),
  z.object({ action: z.literal('goal'), id, page }).strict(),
  z.object({ action: z.literal('task'), id }).strict(),
  z
    .object({
      action: z.literal('history'),
      owner: z.enum(['consult', 'goal', 'task']),
      id: id.optional(),
      before: z.number().int().positive().optional(),
    })
    .strict(),
]);

const clip = (value: string | null, max = 2000) =>
  value && value.length > max
    ? `${value.slice(0, max)}…（続きは Bridge）`
    : value;
const consultView = (c: Consult) => ({
  id: c.id,
  title: c.title,
  status: c.status,
  error: clip(c.error),
});
const goalView = (g: Goal) => ({
  id: g.id,
  title: clip(g.title, 120),
  status: g.status,
  summary: clip(g.planSummary, 1000),
  error: clip(g.planError ?? g.waitReason, 500),
});
const taskView = (t: Task) => ({
  id: t.id,
  number: t.number,
  title: clip(t.title, 120),
  status: t.status,
  paused: t.paused,
  kind: t.kind,
  summary: clip(t.description, 500),
  latest: clip(t.latest, 500),
  result: clip(t.result, 500),
  error: clip(t.error, 500),
  needsGameRestart: t.needsGameRestart,
  // ゲーム内の状態ディスプレイで経過時間を出すため（同じ PC の時計の Unix ミリ秒）。
  startedAt: t.startedAt,
});
const paged = <T>(items: T[], page: number) => ({
  items: items.slice((page - 1) * 5, page * 5),
  page,
  hasMore: items.length > page * 5,
});

/** 接続単位の選択と対象modの境界。表示先を持たず、将来のゲーム内 GUI でも使える。 */
export class ModControl {
  private selected: string | null = null;
  private lastStatus: string | null = null;
  private since = 0;
  private readonly unsubscribe: (() => void)[];

  constructor(
    private readonly core: BridgeCore,
    private readonly projectId: string,
    private readonly send: (data: object) => void,
  ) {
    this.unsubscribe = [
      core.events.on('changed', () => this.refresh()),
      core.events.on('notification', (n) => {
        if ('projectId' in n.target && n.target.projectId === projectId)
          this.send({
            type: 'notice',
            kind: n.kind,
            title: clip(n.title, 120),
            body:
              n.kind === 'approval'
                ? 'Bridge で内容を確認して回答してください'
                : clip(n.body, 300),
          });
      }),
    ];
  }

  close(): void {
    for (const off of this.unsubscribe) off();
  }

  private snapshot() {
    const s = this.core.snapshot();
    const goals = s.goals.filter((g) => g.projectId === this.projectId);
    const goalIds = new Set(goals.map((g) => g.id));
    return {
      project: s.projects.find((p) => p.id === this.projectId),
      goals,
      tasks: s.tasks.filter((t) => goalIds.has(t.goalId)),
      consults: s.consults.filter((c) => c.projectId === this.projectId),
      approvals: s.approvals.filter((a) => a.projectId === this.projectId)
        .length,
    };
  }

  private resolve<T extends { id: string }>(items: T[], prefix: string): T {
    const matches = items.filter(
      (i) => i.id === prefix || i.id.startsWith(prefix),
    );
    if (matches.length !== 1)
      throw new Error(
        '対象が見つからないか、ID の候補が複数あります。接続中の対象modの一覧を確認してください',
      );
    return matches[0];
  }

  private async history(owner: ProgressOwner, before?: number) {
    const all = await this.core.getProgressEvents(owner);
    const events = all
      .filter((e) => before === undefined || e.seq < before)
      .slice(-5);
    return {
      events: events.map((e) => ({
        seq: e.seq,
        kind: e.kind,
        text: clip(e.text),
      })),
      before: events[0]?.seq ?? null,
      hasMore: events.length > 0 && all.some((e) => e.seq < events[0].seq),
    };
  }

  private async select(c: Consult) {
    this.selected = c.id;
    this.lastStatus = c.status;
    const history = await this.history({ type: 'consult', id: c.id });
    this.since = history.events.at(-1)?.seq ?? 0;
    return { kind: 'consult', consult: consultView(c), ...history };
  }

  async request(input: unknown): Promise<object> {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw new Error('操作の種類・引数が不正です');
    const a = parsed.data;
    const s = this.snapshot();
    if (!s.project) throw new Error('対象modが見つかりません');
    switch (a.action) {
      case 'status':
        return {
          kind: 'status',
          name: s.project.name,
          goals: s.goals.length,
          tasks: s.tasks.length,
          consults: s.consults.length,
          approvals: s.approvals,
          selected: this.selected,
        };
      case 'consult_list':
        return {
          kind: 'consult_list',
          ...paged(s.consults.map(consultView), a.page),
        };
      case 'consult_new': {
        const c = await this.core.createConsult(this.projectId, a.text, {
          profileId: null,
          model: null,
          effort: null,
        });
        const selected = await this.select(
          this.snapshot().consults.find((i) => i.id === c.id)!,
        );
        // 高速に応答が終わった場合も、途中の推論・ツール実行は自動表示しない。
        const last = selected.events.at(-1);
        return {
          ...selected,
          events:
            selected.consult.status === 'idle' && last?.kind === 'agent'
              ? [last]
              : [],
          hasMore: false,
        };
      }
      case 'consult_select':
        return this.select(this.resolve(s.consults, a.id));
      case 'consult_send':
      case 'consult_cancel': {
        if (!this.selected) throw new Error('先に相談を選択してください');
        const c = this.resolve(s.consults, this.selected);
        if (a.action === 'consult_send')
          await this.core.sendConsultMessage(c.id, a.text);
        else await this.core.cancelConsult(c.id);
        return { kind: 'accepted' };
      }
      case 'goals':
        return { kind: 'goals', ...paged(s.goals.map(goalView), a.page) };
      case 'goal': {
        const g = this.resolve(s.goals, a.id);
        return {
          kind: 'goal',
          goal: goalView(g),
          ...paged(
            s.tasks.filter((t) => t.goalId === g.id).map(taskView),
            a.page,
          ),
        };
      }
      case 'task':
        return { kind: 'task', task: taskView(this.resolve(s.tasks, a.id)) };
      case 'history': {
        const prefix = a.id ?? (a.owner === 'consult' ? this.selected : null);
        if (!prefix)
          throw new Error('対象の ID を指定するか、相談を選択してください');
        const owner = {
          type: a.owner,
          id: this.resolve<{ id: string }>(
            a.owner === 'consult'
              ? s.consults
              : a.owner === 'goal'
                ? s.goals
                : s.tasks,
            prefix,
          ).id,
        };
        return { kind: 'history', ...(await this.history(owner, a.before)) };
      }
    }
  }

  private refresh(): void {
    if (!this.selected) return;
    const c = this.snapshot().consults.find((c) => c.id === this.selected);
    if (!c || c.status === this.lastStatus) return;
    this.lastStatus = c.status;
    const selected = c.id;
    // 途中経過は自動表示せず、応答の終了時に最後の回答だけを出す。
    void this.core
      .getProgressEvents({ type: 'consult', id: c.id })
      .then((events) => {
        if (this.selected !== selected) return;
        const last = events.at(-1);
        const answer =
          c.status === 'idle' && last?.kind === 'agent' && last.seq > this.since
            ? last.text
            : null;
        if (c.status === 'idle' || c.status === 'failed')
          this.since = events.at(-1)?.seq ?? this.since;
        this.send({
          type: 'consult_state',
          consult: consultView(c),
          answer: clip(answer ?? null),
        });
      })
      .catch(() => undefined);
  }
}
