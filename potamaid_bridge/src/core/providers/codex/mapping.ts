/**
 * Codex app-server のスレッドのアイテムを、Bridge の共通の途中経過に変換する。
 *
 * アイテムは item/started と item/completed で届き、item/completed の内容が正式なもの。
 * 保存する途中経過は item/completed から作り、item/started は「いま行っていること」の表示に使う。
 */
import type { AiEvent } from '../AiProvider';
import type { CommandAction } from './protocol/v2/CommandAction';
import type { ThreadItem } from './protocol/v2/ThreadItem';

/** 詳しい内容（コマンドの出力・差分）として保存する最大の長さ */
const DETAIL_MAX_LENGTH = 4000;

/** 状態を表す言葉 */
const STATUS_SUFFIX: Record<string, string> = {
  completed: '',
  failed: ' — 失敗',
  declined: ' — 拒否されました',
  inProgress: '',
};

/** item/completed のアイテムを、保存する途中経過にする。対象外なら null */
export function completedItemToEvent(item: ThreadItem): AiEvent | null {
  switch (item.type) {
    case 'agentMessage':
      return item.text.trim()
        ? { type: 'progress', kind: 'agent', text: item.text }
        : null;
    case 'reasoning': {
      const summary = item.summary.join('\n').trim();
      return summary
        ? { type: 'progress', kind: 'reasoning', text: summary }
        : null;
    }
    case 'commandExecution': {
      const exit =
        item.exitCode !== null && item.exitCode !== 0
          ? `（終了コード ${item.exitCode}）`
          : '';
      // 一覧には読みやすい説明を出し、元のコマンドと出力は詳しい内容に残す
      const output = item.aggregatedOutput ? `\n${item.aggregatedOutput}` : '';
      return {
        type: 'progress',
        kind: 'command',
        text: `${describeCommand(item.command, item.commandActions)}${STATUS_SUFFIX[item.status] ?? ''}${exit}`,
        detail: truncate(`$ ${item.command}${output}`),
      };
    }
    case 'fileChange':
      return {
        type: 'progress',
        kind: 'fileChange',
        text: `${item.changes.map((c) => describeChange(c.kind.type, c.path)).join('、')}${STATUS_SUFFIX[item.status] ?? ''}`,
        detail: truncate(item.changes.map((c) => c.diff).join('\n')),
      };
    case 'mcpToolCall':
      return {
        type: 'progress',
        kind: 'mcp',
        text: `${item.server}.${item.tool}${STATUS_SUFFIX[item.status] ?? ''}`,
        detail: item.error?.message,
      };
    case 'webSearch':
      return {
        type: 'progress',
        kind: 'webSearch',
        text:
          'query' in item && typeof item.query === 'string'
            ? `Web 検索: ${item.query}`
            : 'Web 検索',
      };
    default:
      // ユーザーの発言は Bridge が自分で記録する。その他は今は表示しない
      return null;
  }
}

/** item/started のアイテムから「いま行っていること」を作る。対象外なら null */
export function startedItemToActivity(item: ThreadItem): AiEvent | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        type: 'activity',
        text: `実行中: ${describeCommand(item.command, item.commandActions)}`,
      };
    case 'fileChange':
      return {
        type: 'activity',
        text: `編集中: ${item.changes.map((c) => c.path).join('、')}`,
      };
    case 'mcpToolCall':
      return { type: 'activity', text: `MCP: ${item.server}.${item.tool}` };
    case 'reasoning':
      return { type: 'activity', text: '考えています…' };
    default:
      return null;
  }
}

/**
 * コマンドの短い説明。
 * Codex が解析した操作（読み取り・一覧・検索）がすべて分かれば、それを並べる。
 * 分からないものがあれば、シェルの呼び出しの包みを外したコマンドを返す。
 */
export function describeCommand(
  command: string,
  actions: CommandAction[],
): string {
  const known = actions.filter((a) => a.type !== 'unknown');
  if (known.length > 0 && known.length === actions.length) {
    return known.map(describeAction).join('、');
  }
  return unwrapShell(command);
}

function describeAction(action: CommandAction): string {
  switch (action.type) {
    case 'read':
      return `読み取り: ${action.path}`;
    case 'listFiles':
      return `一覧: ${action.path ?? '.'}`;
    case 'search':
      return `検索: ${action.query ?? ''}${action.path ? `（${action.path}）` : ''}`;
    case 'unknown':
      return action.command;
  }
}

/** PowerShell・bash の呼び出しで包まれたコマンドから、中身だけを取り出す */
const SHELL_WRAPPERS = [
  // "C:\...\powershell.exe" -NoProfile -Command "..."
  /^"?(?:[^"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?(?:\s+-\w+)*?\s+-Command\s+"([\s\S]*)"$/i,
  // /bin/bash -lc '...'
  /^(?:\/\S*\/)?(?:bash|zsh|sh)\s+-l?c\s+'([\s\S]*)'$/,
];

export function unwrapShell(command: string): string {
  for (const pattern of SHELL_WRAPPERS) {
    const match = pattern.exec(command.trim());
    if (match?.[1] !== undefined) {
      // 引用のために重ねられた円記号を1つに戻す
      return match[1].replace(/\\\\/g, '\\');
    }
  }
  return command;
}

function describeChange(kind: string, file: string): string {
  switch (kind) {
    case 'add':
      return `${file} を作成`;
    case 'delete':
      return `${file} を削除`;
    default:
      return `${file} を編集`;
  }
}

function truncate(text: string | null | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  return text.length > DETAIL_MAX_LENGTH
    ? `${text.slice(0, DETAIL_MAX_LENGTH)}\n…（省略）`
    : text;
}
