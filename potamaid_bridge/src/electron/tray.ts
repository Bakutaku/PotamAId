/**
 * タスクトレイのアイコンとメニュー（仕様書5章「アプリの画面」）。
 *
 * メニュー: 状態の要約、ウィンドウを開く、承認待ちを確認、すべての実行を中止、設定、Bridge を終了。
 * 承認待ち・確認待ちの目標・失敗したタスクがあるときは、アイコンに印を付ける。
 */
import { Menu, Tray, dialog } from 'electron';
import type { BridgeCore } from '../core/BridgeCore';
import { isGoalWorkFinished } from '../shared/goals';
import type { BridgeSnapshot, UiCommand } from '../shared/ipc';
import { createTrayIcons, type TrayIcons } from './trayIcon';

/** メニューを作り直す間隔（状態の変更が続いても作り直しすぎないように） */
const REFRESH_DEBOUNCE_MS = 200;

export interface BridgeTrayActions {
  showWindow(): void;
  /** ウィンドウを開いて、画面に操作を頼む */
  showWindowWith(command: UiCommand): void;
  requestQuit(): void;
}

export class BridgeTray {
  private readonly tray: Tray;
  private readonly icons: TrayIcons;
  private readonly unsubscribe: () => void;
  private timer: NodeJS.Timeout | null = null;
  private balloonShown = false;

  constructor(
    private readonly core: BridgeCore,
    private readonly actions: BridgeTrayActions,
  ) {
    this.icons = createTrayIcons();
    this.tray = new Tray(this.icons.normal);
    this.tray.on('click', () => actions.showWindow());
    this.unsubscribe = core.events.on('changed', () => this.scheduleRefresh());
    this.refresh();
  }

  /** ウィンドウをトレイに隠したことを、初回だけ知らせる（Windows のみ） */
  notifyHidden(): void {
    if (this.balloonShown || process.platform !== 'win32') {
      return;
    }
    this.balloonShown = true;
    this.tray.displayBalloon({
      title: 'PotamAId Bridge',
      content:
        'タスクトレイで動き続けています。終了はアイコンのメニューから行えます。',
      iconType: 'info',
    });
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.unsubscribe();
    this.tray.destroy();
  }

  private scheduleRefresh(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private refresh(): void {
    const snapshot = this.core.snapshot();
    const summary = summarize(snapshot);
    const approvals = snapshot.approvals.length;
    const attention = [
      approvals > 0 ? `承認待ち ${approvals} 件` : '',
      ...attentionLines(snapshot),
    ].filter(Boolean);

    this.tray.setImage(
      attention.length > 0 ? this.icons.withBadge : this.icons.normal,
    );
    this.tray.setToolTip(['PotamAId Bridge', summary, ...attention].join('\n'));
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'PotamAId Bridge', enabled: false },
        { label: summary, enabled: false },
        { type: 'separator' },
        { label: 'ウィンドウを開く', click: () => this.actions.showWindow() },
        {
          label:
            approvals > 0 ? `承認待ちを確認（${approvals}）` : '承認待ちを確認',
          enabled: approvals > 0,
          click: () =>
            this.actions.showWindowWith({
              type: 'showApprovals',
              projectId: null,
            }),
        },
        { type: 'separator' },
        {
          label: 'すべての実行を中止',
          enabled: this.core.hasActiveWork(),
          click: () => void this.confirmCancelAll(),
        },
        {
          label: '設定',
          click: () => this.actions.showWindowWith({ type: 'openSettings' }),
        },
        { type: 'separator' },
        { label: 'Bridge を終了', click: () => this.actions.requestQuit() },
      ]),
    );
  }

  private async confirmCancelAll(): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'PotamAId Bridge',
      message: 'すべての実行と順番待ちを中止しますか？',
      detail:
        '実行中のタスクは未着手に戻ります。それまでのファイルの変更は自動では戻りません。',
      buttons: ['中止する', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) {
      await this.core.cancelAll();
    }
  }
}

/** 「編集 1 / 2・読み取り 1」のような要約 */
function summarize(snapshot: BridgeSnapshot): string {
  const runs = Object.values(snapshot.runs);
  const edit = runs.reduce((sum, r) => sum + r.edit, 0);
  const readOnly = runs.reduce((sum, r) => sum + r.readOnly, 0);
  const queued = runs.reduce((sum, r) => sum + r.queued, 0);
  return `編集 ${edit} / ${snapshot.projects.length}・読み取り ${readOnly}${queued > 0 ? `（順番待ち ${queued}）` : ''}`;
}

/** 承認待ちのほかに、ユーザーの対応を待っているもの（確認待ちの目標・失敗したタスク） */
function attentionLines(snapshot: BridgeSnapshot): string[] {
  const reviewing = snapshot.goals.filter(
    (g) =>
      g.status === 'review' &&
      isGoalWorkFinished(snapshot.tasks.filter((t) => t.goalId === g.id)),
  ).length;
  const failed = snapshot.tasks.filter((t) => t.status === 'failed').length;
  return [
    reviewing > 0 ? `確認待ちの目標 ${reviewing} 件` : '',
    failed > 0 ? `失敗したタスク ${failed} 件` : '',
  ];
}
