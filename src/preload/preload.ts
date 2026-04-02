import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/ipc-channels";
import { PnexConfig, TerminalContext } from "../shared/types";
import { PnexTheme } from "../shared/types";
import { UiThemeContextRequest } from "../shared/types";

interface TerminalHudInfo {
  gitBranch: string;
  pendingCommits: string;
}

interface UiThemeExecCommandPayload {
  command: string;
  args: string[];
  options?: { cwd?: string };
}

function invokeUiThemeContext<T>(request: UiThemeContextRequest): Promise<T> {
  return ipcRenderer.invoke(IpcChannels.UI_THEME_CONTEXT, request);
}

function sendUiThemeContextSync<T>(request: UiThemeContextRequest): T {
  return ipcRenderer.sendSync(IpcChannels.UI_THEME_CONTEXT_SYNC, request) as T;
}

export type AppMenuAction =
  | "config"
  | "new-chat"
  | "copy"
  | "paste"
  | "select-all"
  | "toggle-devtools";

/** Exposed API for renderer process */
const api = {
  /** Send terminal input to main process */
  sendTerminalInput: (data: string): void => {
    ipcRenderer.send(IpcChannels.TERMINAL_INPUT, data);
  },

  /** Notify main of terminal resize */
  sendTerminalResize: (cols: number, rows: number): void => {
    ipcRenderer.send(IpcChannels.TERMINAL_RESIZE, cols, rows);
  },

  getTerminalHud: (cwd: string): Promise<TerminalHudInfo> => {
    return ipcRenderer.invoke(IpcChannels.TERMINAL_HUD, cwd);
  },

  /** Listen for terminal data from pty */
  onTerminalData: (callback: (data: string) => void): void => {
    ipcRenderer.on(IpcChannels.TERMINAL_DATA, (_event, data) => callback(data));
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
  aiCommand: (prompt: string, context?: TerminalContext): Promise<string> => {
    return ipcRenderer.invoke(IpcChannels.AI_COMMAND, prompt, context);
  },

  /** Request AI chat (Ctrl+Shift+I) */
  aiChat: (prompt: string, context?: TerminalContext): Promise<string> => {
    return ipcRenderer.invoke(IpcChannels.AI_CHAT, prompt, context);
  },

  /** List available builtin themes */
  listThemes: (): Promise<PnexTheme[]> => {
    return ipcRenderer.invoke(IpcChannels.THEME_LIST);
  },

  /** Set and persist a theme by name */
  setTheme: (themeName: string): Promise<PnexTheme | null> => {
    return ipcRenderer.invoke(IpcChannels.THEME_SET, themeName);
  },

  /** Listen for theme changes from menu */
  onThemeChanged: (callback: (theme: PnexTheme) => void): void => {
    ipcRenderer.on(IpcChannels.THEME_CHANGED, (_event, theme) =>
      callback(theme),
    );
  },

  uiThemeReadFile: (filePath: string): Promise<string> => {
    return invokeUiThemeContext<string>({
      type: "readFile",
      filePath,
    });
  },

  uiThemeReadDir: (directoryPath: string): Promise<string[]> => {
    return invokeUiThemeContext<string[]>({
      type: "readDir",
      directoryPath,
    });
  },

  uiThemeWriteFile: (filePath: string, content: string): Promise<void> => {
    return invokeUiThemeContext<void>({
      type: "writeFile",
      filePath,
      content,
    });
  },

  uiThemeExecCommand: ({
    command,
    args,
    options,
  }: UiThemeExecCommandPayload): Promise<string> => {
    return invokeUiThemeContext<string>({
      type: "execCommand",
      command,
      args,
      options,
    });
  },

  uiThemeIsFile: (filePath: string): Promise<boolean> => {
    return invokeUiThemeContext<boolean>({
      type: "isFile",
      filePath,
    });
  },

  uiThemeResolvePath: (...segments: string[]): string => {
    return sendUiThemeContextSync<string>({
      type: "resolvePath",
      segments,
    });
  },

  getUsername: (): string => {
    return ipcRenderer.sendSync(IpcChannels.GET_USERNAME) as string;
  },

  setUiTheme: (themeName: string): Promise<string | null> => {
    return ipcRenderer.invoke(IpcChannels.UI_THEME_SET, themeName);
  },

  onUiThemeChanged: (callback: (themeName: string) => void): void => {
    ipcRenderer.on(IpcChannels.UI_THEME_CHANGED, (_event, themeName) => {
      callback(themeName);
    });
  },

  /** New chat - clear history */
  newChat: (): Promise<boolean> => {
    return ipcRenderer.invoke(IpcChannels.NEW_CHAT);
  },

  /** Listen for new chat from menu */
  onNewChat: (callback: () => void): void => {
    ipcRenderer.on(IpcChannels.NEW_CHAT, () => callback());
  },

  onMenuAction: (callback: (action: AppMenuAction) => void): void => {
    ipcRenderer.on(
      IpcChannels.APP_MENU_TRIGGER,
      (_event, action: AppMenuAction) => {
        callback(action);
      },
    );
  },

  minimizeWindow: (): Promise<void> => {
    return ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE);
  },

  toggleDevTools: (): Promise<void> => {
    return ipcRenderer.invoke(IpcChannels.DEVTOOLS_TOGGLE);
  },

  toggleMaximizeWindow: (): Promise<boolean> => {
    return ipcRenderer.invoke(IpcChannels.WINDOW_MAXIMIZE);
  },

  closeWindow: (): Promise<void> => {
    return ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE);
  },

  isWindowMaximized: (): Promise<boolean> => {
    return ipcRenderer.invoke(IpcChannels.WINDOW_IS_MAXIMIZED);
  },

  onWindowMaximizedChanged: (
    callback: (isMaximized: boolean) => void,
  ): void => {
    ipcRenderer.on(
      IpcChannels.WINDOW_MAXIMIZED_CHANGED,
      (_event, isMaximized: boolean) => callback(isMaximized),
    );
  },

  appendCommandHistory: (command: string): void => {
    ipcRenderer.send(IpcChannels.COMMAND_HISTORY_APPEND, command);
  },

  getCommandHistory: (): Promise<string[]> => {
    return ipcRenderer.invoke(IpcChannels.COMMAND_HISTORY_GET);
  },
};

contextBridge.exposeInMainWorld("pnex", api);

export type PnexApi = typeof api;
