/**
 * メインウィンドウ。
 *
 * ウィンドウを閉じても Bridge は終了せず、タスクトレイで動き続ける（仕様書5章「起動と配布」）。
 * 終了はトレイのメニューなどから明示的に行う。
 */
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { assetPath } from './assets';

export class MainWindow {
  private window: BrowserWindow | null = null;
  /** true の間は、閉じたときに隠さず本当に閉じる（終了の処理中） */
  private allowClose = false;

  /**
   * @param onHiddenToTray 閉じる操作でトレイに隠したときに呼ばれる
   */
  constructor(private readonly onHiddenToTray: () => void) {}

  get current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /** ウィンドウを表示する（なければ作る） */
  show(): BrowserWindow {
    const window = this.current ?? this.create();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    return window;
  }

  /** 終了するときに、閉じる操作を止めないようにする */
  prepareToQuit(): void {
    this.allowClose = true;
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'PotamAId Bridge',
      icon: assetPath('icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, // セキュリティのため有効化
        nodeIntegration: false, // セキュリティのため無効化
        sandbox: true,
      },
    });

    window.once('ready-to-show', () => window.show());
    window.on('close', (event) => {
      if (!this.allowClose) {
        event.preventDefault();
        window.hide();
        this.onHiddenToTray();
      }
    });

    // 画面の中のリンクはアプリ内で開かず、既定のブラウザーで開く
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) {
        event.preventDefault();
      }
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      void window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      );
    }

    this.window = window;
    return window;
  }
}
