/**
 * 画面からの操作（IPC）を Bridge の本体につなぎ、本体の変更を画面に送る。
 */
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { BridgeCore } from '../core/BridgeCore';
import {
  BRIDGE_API_METHODS,
  eventChannel,
  invokeChannel,
  type BridgeApi,
  type BridgeEventName,
  type BridgeEvents,
} from '../shared/ipc';

/** 状態の変更をまとめて送る間隔（細かい変更が続いても送りすぎないように） */
const SNAPSHOT_DEBOUNCE_MS = 50;

export interface IpcBridge {
  /** 画面に送る */
  send<E extends BridgeEventName>(event: E, payload: BridgeEvents[E]): void;
  dispose(): void;
}

/**
 * IPC の操作を登録し、本体のイベントを画面へ転送する。
 * @param getWindow 送り先のウィンドウ（閉じていれば null）
 */
export function registerIpc(
  core: BridgeCore,
  getWindow: () => BrowserWindow | null,
): IpcBridge {
  // Electron の機能が必要な操作だけ、ここで実装する。残りは本体に任せる
  const api: BridgeApi = {
    getSnapshot: () => core.getSnapshot(),
    getProgressEvents: (owner) => core.getProgressEvents(owner),
    pickProjectDirectory: async () => {
      const window = getWindow();
      const options = {
        title: '対象modのフォルダーを選ぶ',
        properties: ['openDirectory' as const],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    addProject: (rootPath) => core.addProject(rootPath),
    updateProject: (id, patch) => core.updateProject(id, patch),
    createGoal: (projectId, text, options) =>
      core.createGoal(projectId, text, options),
    retryPlan: (goalId) => core.retryPlan(goalId),
    regeneratePlan: (goalId, instruction) =>
      core.regeneratePlan(goalId, instruction),
    addPlanTask: (goalId, input) => core.addPlanTask(goalId, input),
    updatePlanTask: (taskId, input) => core.updatePlanTask(taskId, input),
    removePlanTask: (taskId) => core.removePlanTask(taskId),
    approvePlan: (goalId) => core.approvePlan(goalId),
    sendGoalInstruction: (goalId, text) =>
      core.sendGoalInstruction(goalId, text),
    markGoalDone: (goalId) => core.markGoalDone(goalId),
    integrateGoal: (goalId) => core.integrateGoal(goalId),
    sendTaskInstruction: (taskId, text) =>
      core.sendTaskInstruction(taskId, text),
    cancelTask: (taskId) => core.cancelTask(taskId),
    resumeTask: (taskId) => core.resumeTask(taskId),
    retryTask: (taskId) => core.retryTask(taskId),
    updateTaskRun: (taskId, input) => core.updateTaskRun(taskId, input),
    createConsult: (projectId, text, options) =>
      core.createConsult(projectId, text, options),
    sendConsultMessage: (consultId, text) =>
      core.sendConsultMessage(consultId, text),
    cancelConsult: (consultId) => core.cancelConsult(consultId),
    respondApproval: (approvalId, response) =>
      core.respondApproval(approvalId, response),
    cancelAll: () => core.cancelAll(),
    updateSettings: (patch) => core.updateSettings(patch),
    refreshProviders: () => core.refreshProviders(),
  };

  for (const method of BRIDGE_API_METHODS) {
    const handler = api[method] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(invokeChannel(method), (_event, ...args: unknown[]) =>
      handler(...args),
    );
  }

  const send = <E extends BridgeEventName>(
    event: E,
    payload: BridgeEvents[E],
  ) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(eventChannel(event), payload);
    }
  };

  let timer: NodeJS.Timeout | null = null;
  const unsubscribe = [
    core.events.on('changed', () => {
      timer ??= setTimeout(() => {
        timer = null;
        send('snapshot', core.snapshot());
      }, SNAPSHOT_DEBOUNCE_MS);
    }),
    core.events.on('progress', (event) => send('progress', event)),
    core.events.on('streaming', (text) => send('streaming', text)),
  ];

  return {
    send,
    dispose() {
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe.forEach((off) => off());
      for (const method of BRIDGE_API_METHODS) {
        ipcMain.removeHandler(invokeChannel(method));
      }
    },
  };
}
