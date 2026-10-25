/**
 * タスクの依存関係の検証と並べ替え（計画の作成時と承認時の両方で使う）。
 */

/** 依存関係を調べるための最小限のタスクの情報 */
export interface GraphNode {
  id: string;
  dependsOn: string[];
}

export type GraphCheck =
  | { ok: true }
  | { ok: false; error: string; taskIds: string[] };

/** 存在しないタスクへの参照・自分自身への依存・循環がないかを調べる */
export function checkTaskGraph(
  nodes: GraphNode[],
  label: (id: string) => string = (id) => id,
): GraphCheck {
  const ids = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    if (node.dependsOn.includes(node.id)) {
      return {
        ok: false,
        error: `${label(node.id)} が自分自身に依存しています`,
        taskIds: [node.id],
      };
    }
    const unknown = node.dependsOn.filter((dep) => !ids.has(dep));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `${label(node.id)} が存在しないタスク（${unknown.join('・')}）に依存しています`,
        taskIds: [node.id],
      };
    }
  }

  const cycle = findCycle(nodes);
  if (cycle) {
    return {
      ok: false,
      error: `依存関係が循環しています（${cycle.map(label).join(' → ')}）`,
      taskIds: cycle,
    };
  }
  return { ok: true };
}

/**
 * 依存先が先に来るように並べ替える。
 * 依存関係で順番が決まらないものは、元の順番を保つ（安定なトポロジカルソート）。
 * 循環がある場合は、残りを元の順番で末尾に付ける。
 */
export function sortByDependencies<T extends GraphNode>(nodes: T[]): T[] {
  const placed = new Set<string>();
  const result: T[] = [];
  let remaining = [...nodes];
  while (remaining.length > 0) {
    const next = remaining.find((n) =>
      n.dependsOn.every((dep) => placed.has(dep)),
    );
    if (!next) {
      return [...result, ...remaining];
    }
    placed.add(next.id);
    result.push(next);
    remaining = remaining.filter((n) => n !== next);
  }
  return result;
}

/** 循環があれば、循環しているタスクの ID を順に返す */
function findCycle(nodes: GraphNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 0: 未訪問、1: 訪問中（いまの経路にある）、2: 訪問済み
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    path.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const s = state.get(dep) ?? 0;
      if (s === 1) {
        return [...path.slice(path.indexOf(dep)), dep];
      }
      if (s === 0) {
        const found = visit(dep);
        if (found) {
          return found;
        }
      }
    }
    path.pop();
    state.set(id, 2);
    return null;
  };

  for (const node of nodes) {
    if ((state.get(node.id) ?? 0) === 0) {
      const found = visit(node.id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}
