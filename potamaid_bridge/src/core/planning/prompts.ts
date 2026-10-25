/**
 * AI に渡す指示文。
 *
 * - `*_INSTRUCTIONS`: セッション全体に与える指示（役割と守ること）
 * - `build*Prompt`: 各ターンでユーザーの指示として送る文章
 */
import type { Goal, Task } from '../../shared/domain';

/**
 * Windows での注意。Windows PowerShell 5.1 の Get-Content は、指定しないと
 * UTF-8 のファイルを CP932 として読むため、日本語が文字化けする。
 */
const WINDOWS_NOTES =
  process.platform === 'win32'
    ? `
Windows PowerShell でファイルを読むときは、Get-Content に -Encoding UTF8 を付けてください。`
    : '';

/** すべてのセッションに共通する前提 */
const COMMON = `あなたは PotamAId Bridge から実行されている、Minecraft の mod 開発を手伝う AI です。
作業ディレクトリは、ユーザーが開発している mod（対象mod）のリポジトリです。
回答と報告は日本語で書いてください。${WINDOWS_NOTES}`;

/** 計画の作成（読み取り専用） */
export const PLAN_INSTRUCTIONS = `${COMMON}

このセッションでは、ユーザーの目標を実現するための計画を作ります。
- ファイルを変更せず、コードとリソースを読んで調べてください。
- 計画は、目標を実装の単位のタスクに分けたものです。各タスクは別々の新しいセッションで実行されるため、1つのセッションで完結できる大きさにしてください。
- タスクには種類（kind）を付けてください。
  - edit: ファイルを編集するタスク。対象modごとに1件ずつ順に実行されます。
  - investigate: ファイルを変更せずに調べるだけのタスク。読み取り専用で、他のタスクと並行して実行されます。結果は、そのタスクに依存するタスクに渡されます。
- 調査タスクは、実装の前に広い範囲を調べる必要があるときだけ作ってください。計画を作る間に調べられたことは、編集タスクの説明に書けば足ります。
- タスクの説明には、実装する内容と、変更するファイルの見込みを具体的に書いてください。調査タスクには、調べる内容と、後のタスクに渡す結果を書いてください。
- 先に終わっている必要があるタスクを dependsOn に書いてください。依存関係のないタスクは並べた順に実行されます。
- タスクはユーザーの確認を待たずに続けて実行され、ユーザーはすべてのタスクが終わってから、まとめて動作を確かめます。
- 最後の発言は、指定した JSON の形式だけにしてください。`;

/** 編集タスクの実行（作業ディレクトリの編集あり） */
export const TASK_INSTRUCTIONS = `${COMMON}

このセッションでは、目標の計画のうち、指定された1件のタスクだけを実装します。
- 他のタスクの範囲には手を出さないでください。必要なら報告に書いてください。
- 変更したら、可能な範囲でビルドやテストで確かめてください。
- Git のコミットやブランチの操作はしないでください。ユーザーは、目標のタスクがすべて終わってから、まとめて動作と差分を確かめます。
- 最後の発言は、指定した JSON の形式で、行った変更と確かめる方法を報告してください。`;

/** 調査タスクの実行（読み取り専用） */
export const INVESTIGATE_INSTRUCTIONS = `${COMMON}

このセッションでは、目標の計画のうち、指定された1件の調査タスクを行います。
- ファイルを変更せず、コードとリソースを読んで調べてください。
- 調べた結果は、このタスクに依存する後のタスクに渡されます。後のタスクがそのまま使えるように、分かったこと（関係するファイル・クラス・手順など）を具体的に書いてください。
- 最後の発言は、指定した JSON の形式で、調べた結果を報告してください。`;

/** 相談（読み取り専用） */
export const CONSULT_INSTRUCTIONS = `${COMMON}

このセッションは相談です。ユーザーの質問に答えてください。
- ファイルを変更しないでください。必要ならコードを読んで調べてから答えてください。
- 実装が必要な内容は、手順や方針の説明にとどめてください。`;

/** 計画の作成の最初のターン */
export function buildPlanPrompt(goal: Goal): string {
  return `${goal.title}（計画作成）

次の目標の計画を作ってください。

# 目標
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

# 追加の指示
${instruction}

# いまの計画（ユーザーが編集した内容を含む）
${formatTaskList(currentTasks)}`;
}

/** タスクの実行の最初のターン。目標と計画の全体と、依存先のタスクの結果を添える */
export function buildTaskPrompt(
  goal: Goal,
  tasks: Task[],
  task: Task,
  instructions: string[],
): string {
  const results = tasks
    .filter((t) => task.dependsOn.includes(t.id) && t.result)
    .map((t) => `## #${t.number} ${t.title}\n${t.result}`)
    .join('\n\n');
  const resultSection = results ? `\n\n# 依存先のタスクの結果\n${results}` : '';
  const extra =
    instructions.length > 0
      ? `\n\n# ユーザーからの追加の指示\n${instructions.map((s) => `- ${s}`).join('\n')}`
      : '';
  const [request, heading] =
    task.kind === 'investigate'
      ? ['調べてください', '今回調べるタスク']
      : ['実装してください', '今回実装するタスク'];
  return `${task.title}（${goal.title} / #${task.number}・${task.kind === 'investigate' ? '調査' : '実装'}）

次の目標の計画のうち、タスク #${task.number} を${request}。

# 目標
${goal.text}

# 計画の要約
${goal.planSummary ?? '（なし）'}

# 計画のタスクの一覧
${formatTaskList(tasks)}${resultSection}

# ${heading}
#${task.number} ${task.title}
${task.description}${extra}`;
}

/** タスクへの追加の指示のターン（同じセッションの続き） */
export function buildFollowUpPrompt(instructions: string[]): string {
  return `このタスクについて、次の指示に対応してください。

${instructions.map((s) => `- ${s}`).join('\n')}`;
}

function formatTaskList(tasks: Task[]): string {
  const numberOf = new Map(tasks.map((t) => [t.id, t.number]));
  return tasks
    .map((t) => {
      const deps = t.dependsOn
        .map((id) => numberOf.get(id))
        .filter((n) => n !== undefined)
        .map((n) => `#${n}`)
        .join('・');
      const kind = t.kind === 'investigate' ? '調査・' : '';
      return `- #${t.number} ${t.title}（${kind}${deps ? `${deps} の後` : '依存なし'}）: ${t.description}`;
    })
    .join('\n');
}
