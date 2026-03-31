import { BrowserWindow, ipcMain, shell } from "electron";
import { readdirSync } from "fs";
import { IpcChannels } from "../../shared/ipc-channels";
import { ShellManager } from "../../lib/terminal";
import { TerminalContext } from "../../shared/types";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  builtinThemes,
  findThemeByName,
} from "../../lib/config";
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
  registerThemeHandlers(win);
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

  shellManager.initPrompt();

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

function getLocalFiles(cwd: string): string[] {
  try {
    return readdirSync(cwd);
  } catch {
    return [];
  }
}

function registerAiHandlers(): void {
  ipcMain.handle(
    IpcChannels.AI_COMMAND,
    async (_event, prompt: string, context?: TerminalContext) => {
      const config = loadConfig();
      const localFiles = context?.cwd ? getLocalFiles(context.cwd) : [];
      return executeCommandAgent(
        prompt,
        config.ai,
        config.shell,
        context,
        localFiles,
      );
    },
  );

  ipcMain.handle(
    IpcChannels.AI_CHAT,
    async (_event, prompt: string, context?: TerminalContext) => {
      const config = loadConfig();
      const localFiles = context?.cwd ? getLocalFiles(context.cwd) : [];
      return executeChatAgent(
        prompt,
        config.ai,
        config.shell,
        context,
        localFiles,
      );
    },
  );
}

function registerAppHandlers(): void {
  ipcMain.handle(IpcChannels.NEW_CHAT, () => {
    clearChatHistory();
    return true;
  });

  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(IpcChannels.WINDOW_MAXIMIZE, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle(IpcChannels.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.on(IpcChannels.WINDOW_MAXIMIZED_CHANGED, () => {
    // no-op reserved channel for renderer listener registration symmetry
  });
}

function registerThemeHandlers(win: BrowserWindow): void {
  ipcMain.handle(IpcChannels.THEME_LIST, () => {
    return builtinThemes;
  });

  ipcMain.handle(IpcChannels.THEME_SET, (_event, themeName: string) => {
    const theme = findThemeByName(themeName);
    if (!theme) return null;

    const config = loadConfig();
    config.theme = theme;
    saveConfig(config);

    win.webContents.send(IpcChannels.THEME_CHANGED, theme);
    return theme;
  });

  const emitWindowState = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }

    win.webContents.send(
      IpcChannels.WINDOW_MAXIMIZED_CHANGED,
      win.isMaximized(),
    );
  };

  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);
}
