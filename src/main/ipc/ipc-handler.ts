import { BrowserWindow, ipcMain, shell } from "electron";
import { IpcChannels } from "../../shared/ipc-channels";
import { ShellManager } from "../../lib/terminal";
import { loadConfig, getConfigPath } from "../../lib/config";
import {
  executeCommandAgent,
  executeChatAgent,
  clearChatHistory,
} from "../../lib/ai";

/**
 * Register all IPC handlers between main and renderer.
 * Bridges xterm in renderer with node-pty in main.
 */
export function registerIpcHandlers(
  win: BrowserWindow,
  shellManager: ShellManager,
): void {
  registerTerminalHandlers(win, shellManager);
  registerConfigHandlers();
  registerAiHandlers();
  registerAppHandlers();
}

function registerTerminalHandlers(
  win: BrowserWindow,
  shellManager: ShellManager,
): void {
  const config = loadConfig();
  const ptyProcess = shellManager.spawn(config.shell);

  ptyProcess.onData((data: string) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }

    win.webContents.send(IpcChannels.TERMINAL_DATA, data);
  });

  win.once("closed", () => {
    shellManager.kill();
  });

  ipcMain.on(IpcChannels.TERMINAL_INPUT, (_event, data: string) => {
    shellManager.write(data);
  });

  ipcMain.on(
    IpcChannels.TERMINAL_RESIZE,
    (_event, cols: number, rows: number) => {
      shellManager.resize(cols, rows);
    },
  );
}

function registerConfigHandlers(): void {
  ipcMain.handle(IpcChannels.CONFIG_GET, () => {
    return loadConfig();
  });

  ipcMain.handle(IpcChannels.CONFIG_OPEN, () => {
    return shell.openPath(getConfigPath());
  });
}

function registerAiHandlers(): void {
  ipcMain.handle(IpcChannels.AI_COMMAND, async (_event, prompt: string) => {
    const config = loadConfig();
    return executeCommandAgent(prompt, config.ai, config.shell);
  });

  ipcMain.handle(IpcChannels.AI_CHAT, async (_event, prompt: string) => {
    const config = loadConfig();
    return executeChatAgent(prompt, config.ai, config.shell);
  });
}

function registerAppHandlers(): void {
  ipcMain.handle(IpcChannels.NEW_CHAT, () => {
    clearChatHistory();
    return true;
  });
}
