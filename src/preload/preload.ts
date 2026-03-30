import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc-channels';
import { PnexConfig } from '../shared/types';

/** Exposed API for renderer process */
const api = {
  /** Send terminal input to main process */
  sendTerminalInput: (data: string): void => {
    ipcRenderer.send(IpcChannels.TERMINAL_INPUT, data);
  },

  /** Notify main of terminal resize */
  sendTerminalResize: (
    cols: number,
    rows: number
  ): void => {
    ipcRenderer.send(
      IpcChannels.TERMINAL_RESIZE,
      cols,
      rows
    );
  },

  /** Listen for terminal data from pty */
  onTerminalData: (
    callback: (data: string) => void
  ): void => {
    ipcRenderer.on(
      IpcChannels.TERMINAL_DATA,
      (_event, data) => callback(data)
    );
  },

  /** Get current config */
  getConfig: (): Promise<PnexConfig> => {
    return ipcRenderer.invoke(IpcChannels.CONFIG_GET);
  },

  /** Open config JSON in default editor */
  openConfig: (): Promise<string> => {
    return ipcRenderer.invoke(IpcChannels.CONFIG_OPEN);
  },

  /** Request AI command (Ctrl+I) */
  aiCommand: (prompt: string): Promise<string> => {
    return ipcRenderer.invoke(
      IpcChannels.AI_COMMAND,
      prompt
    );
  },

  /** Request AI chat (Ctrl+Shift+I) */
  aiChat: (prompt: string): Promise<string> => {
    return ipcRenderer.invoke(
      IpcChannels.AI_CHAT,
      prompt
    );
  },

  /** New chat - clear history */
  newChat: (): Promise<boolean> => {
    return ipcRenderer.invoke(IpcChannels.NEW_CHAT);
  },

  /** Listen for new chat from menu */
  onNewChat: (callback: () => void): void => {
    ipcRenderer.on(IpcChannels.NEW_CHAT, () => callback());
  },
};

contextBridge.exposeInMainWorld('pnex', api);

export type PnexApi = typeof api;
