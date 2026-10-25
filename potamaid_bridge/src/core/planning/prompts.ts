/**
 * AI に渡す指示文。
 *
 * - `*_INSTRUCTIONS`: セッション全体に与える指示（役割と守ること）
 * - `build*Prompt`: 各ターンでユーザーの指示として送る文章
 *
 * 出力の各項目の意味は構造化出力の JSON Schema の description で伝わるため、ここでは繰り返さない。
 */
import type { Goal, Task } from '../../shared/domain';
import { BRIDGE_MCP_SERVER_NAME } from '../mcp/bridgeTools';

/**
 * Windows での注意。Windows PowerShell 5.1 の Get-Content は、指定しないと
 * UTF-8 のファイルを CP932 として読むため、日本語が文字化けする。
 */
const WINDOWS_NOTES =
  process.platform === 'win32'
    ? '\nPowerShell の Get-Content には -Encoding UTF8 を付けてください。'
    : '';

/** すべてのセッションに共通する前提 */
const COMMON = `あなたは PotamAId Bridge から実行される、Minecraft の mod 開発を手伝う AI です。
作業ディレクトリはユーザーの mod のリポジトリです。日本語で答えてください。
目標やほかのタスクの詳細・結果は、${BRIDGE_MCP_SERVER_NAME} の MCP ツールで調べられます。${WINDOWS_NOTES}`;

/** 計画の作成（読み取り専用） */
export const PLAN_INSTRUCTIONS = `${COMMON}

ファイルを変更せずにコードを調べ、ユーザーの目標を実装の単位のタスクに分けた計画を作ってください。
- 各タスクは別々の新しいセッションで実行します。1つのセッションで終わる大きさにしてください。
- edit は対象modごとに1件ずつ、investigate は読み取り専用で並行して実行します。調査タスクは、実装の前に広く調べる必要があるときだけ作ってください。
- タスクはユーザーの確認なしに続けて実行し、ユーザーは最後にまとめて動作を確かめます。`;

/** 編集タスクの実行（作業ディレクトリの編集あり） */
export const TASK_INSTRUCTIONS = `${COMMON}

計画のうち、指定された1件のタスクだけを実装してください。
- 他のタスクの範囲には手を出さず、必要なら報告に書いてください。
- 可能な範囲でビルドやテストで確かめてください。
- Git のコミットやブランチの操作はしないでください。`;

/** 調査タスクの実行（読み取り専用） */
export const INVESTIGATE_INSTRUCTIONS = `${COMMON}

計画のうち、指定された1件の調査タスクを、ファイルを変更せずに行ってください。
結果は後のタスクに渡します。関係するファイル・クラス・手順などを具体的に報告してください。`;

/** 相談（読み取り専用） */
export const CONSULT_INSTRUCTIONS = `${COMMON}

ユーザーの質問に答えてください。ファイルは変更せず、実装が必要な内容は手順や方針の説明にとどめてください。`;

/** 計画の作成の最初のターン */
export function buildPlanPrompt(goal: Goal): string {
  return `${goal.title}（計画作成）

次の目標の計画を作ってください。

${goal.text}`;
}

/** 指示を足して計画を作り直すターン（同じセッションの続き） */
export function buildReplanPrompt(
  goal: Goal,
  instruction: string,
  currentTasks: Task[],
): string {
  return `${goal.title}（計画の見直し）

次の指示を踏まえて、計画を作り直してください。

# 目標
${goal.text}

# 指示
${instruction}

# いまの計画（ユーザーが編集した内容を含む）
${currentTasks.map((t) => `${taskLine(t, currentTasks)}: ${t.description}`).join('\n')}`;
}

/**
 * タスクの実行の最初のターン。
 * 目標と、計画の一覧（題名だけ）、依存先のタスクの結果を添える。
 * ほかのタスクの説明や結果は、必要なら AI が Bridge の MCP ツールで調べる。
 */
export function buildTaskPrompt(
  goal: Goal,
  tasks: Task[],
  task: Task,
  instructions: string[],
): string {
  const investigate = task.kind === 'investigate';
  const results = tasks
    .filter((t) => task.dependsOn.includes(t.id) && t.result)
    .map((t) => `## #${t.number} ${t.title}\n${t.result}`)
    .join('\n\n');
  const sections = [
    `# 目標\n${goal.text}`,
    goal.planSummary && `# 計画の方針\n${goal.planSummary}`,
    `# 計画のタスク\n${tasks.map((t) => taskLine(t, tasks, task)).join('\n')}`,
    results && `# 依存先のタスクの結果\n${results}`,
    `# 今回のタスク: #${task.number} ${task.title}\n${task.description}`,
    instructions.length > 0 &&
      `# ユーザーからの追加の指示\n${bulletList(instructions)}`,
  ].filter(Boolean);
  return `${task.title}（${goal.title} / #${task.number}・${investigate ? '調査' : '実装'}）

タスク #${task.number} を${investigate ? '調べて' : '実装して'}ください。

${sections.join('\n\n')}`;
}

/** タスクへの追加の指示のターン（同じセッションの続き） */
export function buildFollowUpPrompt(instructions: string[]): string {
  return `このタスクについて、次の指示に対応してください。

${bulletList(instructions)}`;
}

/** 計画の一覧の1行（「- #2 題名（調査・#1 の後・完了）」） */
function taskLine(t: Task, tasks: Task[], current?: Task): string {
  const numberOf = new Map(tasks.map((x) => [x.id, x.number]));
  const deps = t.dependsOn
    .map((id) => numberOf.get(id))
    .filter((n) => n !== undefined)
    .map((n) => `#${n}`)
    .join('・');
  const notes = [
    t.kind === 'investigate' && '調査',
    deps && `${deps} の後`,
    t.id === current?.id ? '今回' : t.status === 'done' && '完了',
  ].filter(Boolean);
  return `- #${t.number} ${t.title}${notes.length > 0 ? `（${notes.join('・')}）` : ''}`;
}

function bulletList(items: string[]): string {
  return items.map((s) => `- ${s}`).join('\n');
}
