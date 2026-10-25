/**
 * Electron の main プロセスの入口。
 *
 * Bridge の本体（BridgeCore）を作り、ウィンドウ・トレイ・IPC・終了の処理を組み立てる。
 */
import { app } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { BridgeCore } from '../core/BridgeCore';
import { CodexProvider } from '../core/providers/codex/CodexProvider';
import type { UiCommand } from '../shared/ipc';
import { registerIpc } from './ipc';
import { DesktopNotifier } from './notifications';
import { QuitController } from './quit';
import { BridgeTray } from './tray';
import { MainWindow } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Bridge は1つだけ動かす。2つ目を起動したら、動いている方のウィンドウを開く
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(startBridge);
}

function startBridge(): void {
  // Windows ではアプリの ID がないとデスクトップ通知が出ない。
  // パッケージでは Squirrel のショートカットと同じ ID を使う。
  // 開発中に electron.exe のパスを ID にすると、タスクバーが Electron のアイコンになるため、専用の ID にする
  if (process.platform === 'win32') {
    app.setAppUserModelId(
      app.isPackaged
        ? 'com.squirrel.potamaid.potamaid'
        : 'com.potamaid.bridge.dev',
    );
  }

  const core = new BridgeCore({
    databasePath: path.join(app.getPath('userData'), 'bridge.sqlite'),
    createProviders: (getSettings) => [
      new CodexProvider({
        getSettings,
        clientVersion: app.getVersion(),
        onLog: (message) => console.log(message),
      }),
    ],
    onError: (error) => console.error(error),
  });

  let tray: BridgeTray | null = null;
  const window = new MainWindow(() => tray?.notifyHidden());
  const ipc = registerIpc(core, () => window.current);

  const showWindowWith = (command: UiCommand) => {
    const win = window.show();
    // 画面の読み込みが終わってから送る
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () =>
        ipc.send('uiCommand', command),
      );
    } else {
      ipc.send('uiCommand', command);
    }
  };

  const notifier = new DesktopNotifier(
    core,
    () => window.current,
    showWindowWith,
  );

  const quit = new QuitController(core, () => {
    window.prepareToQuit();
    tray?.dispose();
    notifier.dispose();
    ipc.dispose();
  });

  tray = new BridgeTray(core, {
    showWindow: () => window.show(),
    showWindowWith,
    requestQuit: () => void quit.requestQuit(),
  });

  app.on('second-instance', () => window.show());
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => window.show());
  // ウィンドウを閉じてもトレイで動き続けるため、ここでは終了しない
  app.on('window-all-closed', () => undefined);

  core.start();
  window.show();
}
