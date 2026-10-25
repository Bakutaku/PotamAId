/**
 * 型付きのイベントの発行と購読。
 * Bridge の本体から、画面（IPC）や将来の Mod との通信へ変更を知らせるのに使う。
 */
export class TypedEmitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<
    keyof Events,
    Set<(payload: never) => void>
  >();

  /** 購読する。戻り値の関数で購読をやめる */
  on<E extends keyof Events>(
    event: E,
    listener: (payload: Events[E]) => void,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (payload: Events[E]) => void)(payload);
    }
  }
}
