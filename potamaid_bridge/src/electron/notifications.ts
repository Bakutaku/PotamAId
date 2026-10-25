/**
 * デスクトップ通知（仕様書3章「通知」）。
 *
 * 目標の確認待ち・承認待ち・タスクの失敗を、OS の通知で知らせる。
 * 通知を選ぶと、ウィンドウを開いてその目標・タスク・承認待ちを表示する。
 * ウィンドウを見ている間と、設定で止めているときは出さない。
 */
import { Notification, type BrowserWindow } from 'electron';
import type { BridgeCore } from '../core/BridgeCore';
import type { BridgeNotification } from '../core/runners/RunnerContext';
import type { UiCommand } from '../shared/ipc';
import { assetPath } from './assets';

export class DesktopNotifier {
  /** 表示中の通知。参照を残さないと、ガベージコレクションで選んだときの処理が動かなくなる */
  private readonly shown = new Set<Notification>();
  private readonly unsubscribe: () => void;

  /**
   * @param getWindow いまのウィンドウ（閉じていれば null）
   * @param open 通知を選んだときに、ウィンドウを開いて画面に頼む操作
   */
  constructor(
    private readonly core: BridgeCore,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly open: (command: UiCommand) => void,
  ) {
    this.unsubscribe = core.events.on('notification', (notification) =>
      this.show(notification),
    );
  }

  dispose(): void {
    this.unsubscribe();
    for (const notification of this.shown) {
      notification.close();
    }
    this.shown.clear();
  }

  private show(notification: BridgeNotification): void {
    if (
      !this.core.snapshot().settings.desktopNotifications ||
      !Notification.isSupported() ||
      this.isWindowFocused()
    ) {
      return;
    }
    const toast = new Notification({
      title: notification.title,
      body: notification.body,
      icon: assetPath('icon.png'),
    });
    const forget = () => this.shown.delete(toast);
    toast.on('click', () => {
      forget();
      this.open(notification.target);
    });
    toast.on('close', forget);
    toast.on('failed', forget);
    this.shown.add(toast);
    toast.show();
  }

  private isWindowFocused(): boolean {
    const window = this.getWindow();
    return !!window && window.isVisible() && window.isFocused();
  }
}
