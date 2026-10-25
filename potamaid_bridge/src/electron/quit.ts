/**
 * Bridge の終了（仕様書5章「起動と配布」）。
 *
 * 実行中・順番待ちのものがあれば警告し、了承されたら本体を止めてから終了する。
 * OS のシャットダウンなど、メニュー以外からの終了も同じ流れを通す。
 */
import { app, dialog } from 'electron';
import type { BridgeCore } from '../core/BridgeCore';

export class QuitController {
  private quitting = false;

  constructor(
    private readonly core: BridgeCore,
    /** 終了の直前に呼ばれる（ウィンドウやトレイの片付け） */
    private readonly beforeQuit: () => void,
  ) {
    app.on('before-quit', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        void this.requestQuit();
      }
    });
  }

  /** 終了を求める。警告でキャンセルされたら何もしない */
  async requestQuit(): Promise<void> {
    if (this.quitting) {
      return;
    }
    if (this.core.hasActiveWork()) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'PotamAId Bridge',
        message: '実行中・順番待ちのタスクがあります。終了しますか？',
        detail:
          '終了すると、実行中のタスクと相談は中断し、次の起動で未着手に戻ります。',
        buttons: ['終了する', 'キャンセル'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) {
        return;
      }
    }
    this.quitting = true;
    this.beforeQuit();
    await this.core.shutdown();
    app.quit();
  }
}
