import { BrowserWindow, ipcMain, shell } from "electron";
import { readdirSync } from "fs";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { IpcChannels } from "../../shared/ipc-channels";
import { ShellManager } from "../../lib/terminal";
import { TerminalContext } from "../../shared/types";
import { UiThemeContextRequest } from "../../shared/types";
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

const execFileAsync = promisify(execFile);

function isGitBashStyleWindowsPath(value: string): boolean {
  return process.platform === "win32" && /^\/[a-zA-Z](?:\/|$)/.test(value);
}

function normalizeGitBashWindowsPath(value: string): string {
  if (!isGitBashStyleWindowsPath(value)) {
    return value;
  }

  const driveLetter = value[1].toUpperCase();
  const rest = value.slice(2).replace(/\//g, "\\");
  return `${driveLetter}:${rest || "\\"}`;
}

function normalizeUiThemePath(value: string): string {
  return normalizeGitBashWindowsPath(value);
}

function normalizeUiThemeSegments(segments: string[]): string[] {
  return segments.map((segment, index) => {
    if (index === 0) {
      return normalizeUiThemePath(segment);
    }

    return segment.replace(/\\/g, "/");
  });
}

function normalizeUiThemeExecOptions(options?: {
  cwd?: string;
}): { cwd?: string } | undefined {
  if (!options) {
    return undefined;
  }

  return {
    ...options,
    cwd: options.cwd ? normalizeUiThemePath(options.cwd) : options.cwd,
  };
}

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

  ipcMain.handle(IpcChannels.TERMINAL_HUD, async (_event, cwd: string) => {
    return getTerminalHudInfo(cwd);
  });
}

async function getTerminalHudInfo(
  cwd: string,
): Promise<{ gitBranch: string; pendingCommits: string }> {
  const gitBranch = await runGitCommand(cwd, ["branch", "--show-current"]);
  const pendingCommits = await runGitCommand(cwd, [
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);

  return {
    gitBranch,
    pendingCommits,
  };
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "";
  }
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

  ipcMain.handle(IpcChannels.DEVTOOLS_TOGGLE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
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

  ipcMain.handle(
    IpcChannels.UI_THEME_CONTEXT,
    async (_event, request: UiThemeContextRequest) => {
      switch (request.type) {
        case "readFile":
          return fs.readFile(normalizeUiThemePath(request.filePath), "utf-8");
        case "readDir":
          return fs.readdir(normalizeUiThemePath(request.directoryPath));
        case "writeFile":
          await fs.writeFile(
            normalizeUiThemePath(request.filePath),
            request.content,
            "utf-8",
          );
          return;
        case "execCommand": {
          const { stdout } = await execFileAsync(
            request.command,
            request.args,
            {
              cwd: normalizeUiThemeExecOptions(request.options)?.cwd,
              windowsHide: true,
              maxBuffer: 1024 * 1024,
            },
          );
          return stdout;
        }
        case "isFile":
          try {
            const stats = await fs.stat(normalizeUiThemePath(request.filePath));
            return stats.isFile() || stats.isDirectory();
          } catch {
            return false;
          }
        case "resolvePath":
          return path.resolve(...normalizeUiThemeSegments(request.segments));
      }
    },
  );

  ipcMain.on(
    IpcChannels.UI_THEME_CONTEXT_SYNC,
    (event, request: UiThemeContextRequest) => {
      if (request.type !== "resolvePath") {
        event.returnValue = null;
        return;
      }

      event.returnValue = path.resolve(
        ...normalizeUiThemeSegments(request.segments),
      );
    },
  );

  ipcMain.handle(IpcChannels.UI_THEME_SET, (_event, themeName: string) => {
    if (!themeName) {
      return null;
    }

    const config = loadConfig();
    config.uiThemeName = themeName;
    saveConfig(config);

    win.webContents.send(IpcChannels.UI_THEME_CHANGED, themeName);
    return themeName;
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
