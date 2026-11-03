import { z } from 'zod';
import type { BridgeCore } from '../BridgeCore';
import type {
  Approval,
  Consult,
  Goal,
  ProgressOwner,
  Task,
} from '../../shared/domain';
import { describeApproval } from '../../shared/approvals';

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
  z.object({ action: z.literal('approvals'), page }).strict(),
  z
    .object({
      action: z.literal('approval_respond'),
      id: id.optional(),
      decision: z.enum(['allow', 'allowForSession', 'deny']),
    })
    .strict(),
  z
    .object({
      action: z.literal('approval_answer'),
      id: id.optional(),
      question: z.number().int().min(1).max(20),
      value: z.string().trim().min(1).max(500),
    })
    .strict(),
  z.object({ action: z.literal('goal_approve'), id }).strict(),
  z.object({ action: z.literal('task_cancel'), id }).strict(),
  z.object({ action: z.literal('task_resume'), id }).strict(),
  z
    .object({
      action: z.literal('history'),
      owner: z.enum(['consult', 'goal', 'task']),
      id: id.optional(),
      before: z.number().int().positive().optional(),
    })
    .strict(),
]);

/** ゲームの画面にそのまま見せてよい、固定の文面のエラー（スタックなどを含む例外は見せない） */
export class GameOperationError extends Error {}

/** 中の処理（BridgeCore）が投げる、ゲームに見せてよい固定の文面 */
const SAFE_CORE_ERRORS = [
  '計画を作り直している間は承認できません',
  'タスクがありません',
  '承認の処理中です',
  'このタスクは実行していません',
  '停止中のタスクだけ再開できます',
];

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
  entity: 'goal',
  // ゲームがクリックできるボタンにする操作（固定の語だけ。コマンドは Mod が組み立てる）
  actions: g.status === 'planReview' ? ['approve'] : [],
  title: clip(g.title, 120),
  status: g.status,
  summary: clip(g.planSummary, 1000),
  error: clip(g.planError ?? g.waitReason, 500),
});
const taskView = (t: Task) => ({
  id: t.id,
  entity: 'task',
  actions: t.paused
    ? ['resume']
    : t.status === 'running' || t.status === 'approval'
      ? ['cancel']
      : [],
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
/** 承認の案内に使う ID。ID は先頭8文字以上で指定できる */
const shortId = (value: string) => value.slice(0, 8);

const approvalLines = (a: Approval): string[] => {
  const id = shortId(a.id);
  const lines: string[] = [];
  if (a.kind === 'command') {
    lines.push(`コマンド: ${a.command ?? ''}`);
    if (a.cwd) lines.push(`場所: ${a.cwd}`);
  } else if (a.kind === 'fileChange') {
    lines.push(`ファイルの変更: ${a.files.join('、')}`);
  } else if (a.kind === 'question') {
    a.questions.forEach((q, i) => {
      lines.push(
        `質問${i + 1}: ${q.header ? `${q.header} ` : ''}${q.question}`,
      );
      if (q.secret)
        lines.push('  （秘密の回答のため、Bridge で回答してください）');
      q.options.forEach((o, n) => lines.push(`  ${n + 1}) ${o.label}`));
    });
  } else {
    lines.push(describeApproval(a));
    if (a.message) lines.push(a.message);
    if (a.url) lines.push(`URL: ${a.url}`);
  }
  if (a.reason) lines.push(`理由: ${a.reason}`);
  if (a.kind === 'command' || a.kind === 'fileChange')
    lines.push(
      `/potamaid approval ${id} allow | always（このセッションの間は許可） | deny`,
    );
  else if (a.kind === 'question' && !a.questions.some((q) => q.secret))
    lines.push(
      `/potamaid approval ${id} answer <質問番号> <選択肢の番号か回答> | deny`,
    );
  else lines.push(`/potamaid approval ${id} deny（回答は Bridge で行います）`);
  return lines;
};
/** クリックできるボタンにする回答。質問は、秘密でなく選択肢が1問だけのときに選択肢ごとのボタンも出す */
const approvalButtons = (a: Approval) => {
  if (a.kind === 'command' || a.kind === 'fileChange')
    return { actions: ['allow', 'always', 'deny'], answers: [] };
  const single = a.questions.length === 1 ? a.questions[0] : null;
  const choices =
    single && !single.secret && a.kind === 'question'
      ? single.options.slice(0, 8).map((o) => clip(o.label, 40))
      : [];
  return { actions: ['deny'], answers: choices };
};
const paged = <T>(items: T[], page: number) => ({
  items: items.slice((page - 1) * 5, page * 5),
  page,
  hasMore: items.length > page * 5,
});

/** 接続単位の選択と対象modの境界。表示先を持たず、将来のゲーム内 GUI でも使える。 */
export class ModControl {
  private selected: string | null = null;
  /** 質問への回答の途中経過。すべて答えたら送る（秘密の質問は受け付けない） */
  private readonly partialAnswers = new Map<string, Map<string, string[]>>();
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
      core.events.on('approvalResolved', (r) => {
        if (r.projectId !== projectId) return;
        this.partialAnswers.delete(r.approvalId);
        this.send({
          type: 'approval_resolved',
          id: r.approvalId,
          by: r.by,
          decision: r.decision,
        });
      }),
      core.events.on('notification', (n) => {
        if ('projectId' in n.target && n.target.projectId === projectId)
          this.send({
            type: 'notice',
            kind: n.kind,
            title: clip(n.title, 120),
            body:
              n.kind === 'approval'
                ? '/potamaid approvals で内容を確認して回答できます（Bridge の画面でも可）'
                : clip(n.body, 300),
          });
      }),
    ];
  }

  close(): void {
    this.partialAnswers.clear();
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
      approvals: s.approvals.filter((a) => a.projectId === this.projectId),
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

  /** 承認待ちを探す。見つからなくても、回答済みの承認なら先に回答した側を知らせる */
  private pendingApproval(
    approvals: Approval[],
    prefix: string | undefined,
  ): Approval {
    if (prefix === undefined) {
      // ID を省いた回答は、取り違えないよう承認待ちが1件のときだけ受け付ける
      if (approvals.length === 0)
        throw new GameOperationError('承認待ちはありません');
      if (approvals.length > 1)
        throw new GameOperationError(
          '承認待ちが複数あります。/potamaid approvals のボタンか ID で指定してください',
        );
      return approvals[0];
    }
    try {
      return this.resolve(approvals, prefix);
    } catch (error) {
      const answered = this.core.resolvedApprovalError(this.projectId, prefix);
      throw answered ? new GameOperationError(answered.message) : error;
    }
  }

  private async safely<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        SAFE_CORE_ERRORS.includes(message) ||
        message.startsWith('この承認は')
      )
        throw new GameOperationError(message);
      throw error;
    }
  }

  private ownerTitle(
    owner: ProgressOwner,
    s: ReturnType<ModControl['snapshot']>,
  ): string {
    if (owner.type === 'task') {
      const t = s.tasks.find((t) => t.id === owner.id);
      return t ? `タスク #${t.number} ${t.title}` : 'タスク';
    }
    if (owner.type === 'goal')
      return `計画: ${s.goals.find((g) => g.id === owner.id)?.title ?? '目標'}`;
    return `相談: ${s.consults.find((c) => c.id === owner.id)?.title ?? ''}`;
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
          approvals: s.approvals.length,
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
      case 'approvals':
        return {
          kind: 'approvals',
          ...paged(
            s.approvals.map((approval) => ({
              id: approval.id,
              entity: 'approval',
              ...approvalButtons(approval),
              title: clip(this.ownerTitle(approval.owner, s), 120),
              status: 'approval',
              summary: clip(approvalLines(approval).join('\n'), 1200),
            })),
            a.page,
          ),
        };
      case 'approval_respond': {
        const approval = this.pendingApproval(s.approvals, a.id);
        const permission =
          approval.kind === 'command' || approval.kind === 'fileChange';
        // 質問・フォーム・URL の許可は回答の内容を伴うため、ゲーム内では拒否だけ受け付ける
        if (!permission && a.decision !== 'deny')
          throw new GameOperationError(
            approval.kind === 'question'
              ? 'この質問には approval <ID> answer <質問番号> <回答> で答えてください'
              : 'この要求への回答は Bridge の画面で行ってください（拒否はゲーム内でもできます）',
          );
        await this.safely(() =>
          this.core.respondApproval(
            approval.id,
            { decision: a.decision },
            'game',
          ),
        );
        return { kind: 'accepted' };
      }
      case 'approval_answer': {
        const approval = this.pendingApproval(s.approvals, a.id);
        if (approval.kind !== 'question')
          throw new GameOperationError('回答できるのは AI からの質問だけです');
        // 秘密の回答は、ゲーム内のチャットに入力させない
        if (approval.questions.some((q) => q.secret))
          throw new GameOperationError(
            '秘密の回答を含む質問は、Bridge の画面で回答してください',
          );
        const question = approval.questions[a.question - 1];
        if (!question)
          throw new GameOperationError('質問番号が正しくありません');
        let answer = a.value;
        if (question.options.length > 0 && /^\d+$/.test(a.value)) {
          const option = question.options[Number(a.value) - 1];
          if (option) answer = option.label;
          // 自由な回答が許される質問では、範囲外の数字（ポート番号など）をそのまま回答にする
          else if (!question.allowOther)
            throw new GameOperationError('選択肢の番号が正しくありません');
        } else if (!question.allowOther) {
          throw new GameOperationError(
            'この質問は選択肢の番号で答えてください',
          );
        }
        const partial =
          this.partialAnswers.get(approval.id) ?? new Map<string, string[]>();
        partial.set(question.id, [answer]);
        const remaining = approval.questions.flatMap((q, i) =>
          partial.has(q.id) ? [] : [i + 1],
        );
        if (remaining.length > 0) {
          this.partialAnswers.set(approval.id, partial);
          return { kind: 'approval_progress', remaining };
        }
        await this.safely(() =>
          this.core.respondApproval(
            approval.id,
            { decision: 'allow', answers: Object.fromEntries(partial) },
            'game',
          ),
        );
        this.partialAnswers.delete(approval.id);
        return { kind: 'accepted' };
      }
      case 'goal_approve': {
        const goal = this.resolve(s.goals, a.id);
        if (goal.status !== 'planReview')
          throw new GameOperationError('計画の確認待ちの目標だけ承認できます');
        await this.safely(() => this.core.approvePlan(goal.id));
        return { kind: 'accepted' };
      }
      case 'task_cancel':
      case 'task_resume': {
        const task = this.resolve(s.tasks, a.id);
        await this.safely(() =>
          a.action === 'task_cancel'
            ? this.core.cancelTask(task.id)
            : this.core.resumeTask(task.id),
        );
        return { kind: 'accepted' };
      }
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
