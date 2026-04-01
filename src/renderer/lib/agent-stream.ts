import { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import {
  PromptHudStatus,
  ThemeCommandBase,
  ThemeContext,
} from "../ui-themes/theme-command-base";
import { defaultUiThemeName, findUiThemeByName } from "../ui-themes";
import {
  markPromptReady,
  onCommandStateChange,
} from "./terminal-command-state";

declare const pnex: import("../../preload/preload").PnexApi;

const PNEX_STREAM_CWD = "__PNEX_CWD__";
const PNEX_STREAM_EXIT = "__PNEX_EXIT__";

class StaleUiThemeRenderError extends Error {
  public constructor() {
    super("Stale UI theme render");
  }
}

interface PromptHudEntry {
  id: number;
  cwd: string;
  status: PromptHudStatus;
  marker: IMarker;
  decoration: IDecoration;
  frameElement: HTMLElement;
  contentElement: HTMLElement;
  hostElement: HTMLElement | null;
  theme: ThemeCommandBase | null;
  renderVersion: number;
  isDisposed: boolean;
}

let _currentCwd = "";
let _terminal: Terminal | null = null;
let _activeUiThemeName = defaultUiThemeName;
let _pendingExitCode = 0;
let _pendingPromptCwd: string | null = null;
let _nextPromptHudId = 1;
let _activePromptHudId: number | null = null;
let _debugOverlay: HTMLElement | null = null;

const _promptHudHistory = new Map<number, PromptHudEntry>();
const _promptHudOrder: number[] = [];
export function getCurrentCwd(): string {
  return _currentCwd;
}

export function resetCommandHudHistory(): void {
  clearPromptHudHistory();
}

export function registerAgentHandlers(
  terminal: Terminal,
  container: HTMLElement,
  initialUiThemeName?: string,
): void {
  _terminal = terminal;
  _activeUiThemeName = initialUiThemeName || defaultUiThemeName;
  _debugOverlay = getOrCreateDebugOverlay(container);

  terminal.onWriteParsed(() => {
    updateDebugOverlay("onWriteParsed disparou");
    flushPendingPromptHud();
  });

  pnex.onUiThemeChanged((themeName) => {
    _activeUiThemeName = themeName || defaultUiThemeName;
    rerenderAllPromptHuds();
  });

  onCommandStateChange((isRunning) => {
    if (isRunning) {
      markActivePromptHudRunning();
    }
  });
}

function createPromptHud(cwd: string): void {
  if (!_terminal) {
    return;
  }

  const marker = _terminal.registerMarker(0);
  updateDebugOverlay(`marker criado: line=${marker.line}`);
  const decoration = _terminal.registerDecoration({
    marker,
    x: 0,
    width: 1,
    height: 1,
  });

  if (!decoration) {
    updateDebugOverlay("registerDecoration retornou undefined");
    return;
  }

  updateDebugOverlay(`decoration criada para cwd: ${cwd}`);

  const entry: PromptHudEntry = {
    id: _nextPromptHudId++,
    cwd,
    status: "ready",
    marker,
    decoration,
    frameElement: createHudFrameElement(),
    contentElement: createHudContentElement(),
    hostElement: null,
    theme: null,
    renderVersion: 0,
    isDisposed: false,
  };

  entry.frameElement.appendChild(entry.contentElement);
  bindDecoration(entry);

  _promptHudHistory.set(entry.id, entry);
  _promptHudOrder.push(entry.id);
  _activePromptHudId = entry.id;

  decoration.onDispose(() => {
    disposePromptHudEntry(entry.id, false);
  });

  marker.onDispose(() => {
    disposePromptHudEntry(entry.id, false);
  });

  createOrRefreshTheme(entry, true);

  requestAnimationFrame(() => {
    _terminal?.refresh(0, _terminal.rows - 1);
  });
}

function bindDecoration(entry: PromptHudEntry): void {
  entry.decoration.onRender((element) => {
    if (entry.isDisposed) {
      return;
    }

    updateDebugOverlay(`decoration.onRender disparou: hud=${entry.id}`);

    entry.hostElement = element;
    element.classList.add("pnex-command-decoration");
    element.style.overflow = "visible";
    element.style.width = "0px";
    element.style.height = "0px";
    element.style.pointerEvents = "none";
    element.style.zIndex = "20";

    if (entry.frameElement.parentElement !== element) {
      element.replaceChildren(entry.frameElement);
    }

    syncPromptHudDataset(entry);
  });
}

function flushPendingPromptHud(): void {
  if (!_pendingPromptCwd) {
    return;
  }

  const cwd = _pendingPromptCwd;
  _pendingPromptCwd = null;
  finalizeActivePromptHud(_pendingExitCode);
  createPromptHud(cwd);
}

function finalizeActivePromptHud(exitCode: number): void {
  if (_activePromptHudId === null) {
    return;
  }

  const entry = _promptHudHistory.get(_activePromptHudId);
  if (!entry || entry.isDisposed) {
    _activePromptHudId = null;
    return;
  }

  entry.status = exitCode === 0 ? "success" : "error";
  renderPromptHud(entry);
  _activePromptHudId = null;
}

function markActivePromptHudRunning(): void {
  if (_activePromptHudId === null) {
    return;
  }

  const entry = _promptHudHistory.get(_activePromptHudId);
  if (!entry || entry.isDisposed || entry.status === "running") {
    return;
  }

  entry.status = "running";
  renderPromptHud(entry);
}

function rerenderAllPromptHuds(): void {
  for (const promptHudId of _promptHudOrder) {
    const entry = _promptHudHistory.get(promptHudId);
    if (!entry || entry.isDisposed) {
      continue;
    }

    createOrRefreshTheme(entry, true);
  }
}

function createOrRefreshTheme(
  entry: PromptHudEntry,
  runInitialLoad: boolean,
): void {
  const ThemeCtor = findUiThemeByName(_activeUiThemeName);
  const context = createThemeContext(entry);
  const theme = new ThemeCtor(context);
  theme.status = entry.status;
  theme.doRender = () => {
    renderPromptHudById(entry.id);
  };

  entry.theme = theme;
  renderPromptHud(entry);

  if (!runInitialLoad) {
    return;
  }

  void Promise.resolve(theme.onInitialLoad()).catch((error) => {
    if (!(error instanceof StaleUiThemeRenderError)) {
      console.error("Failed to initialize UI theme", error);
    }
  });
}

function renderPromptHudById(promptHudId: number): void {
  const entry = _promptHudHistory.get(promptHudId);
  if (!entry || entry.isDisposed) {
    return;
  }

  renderPromptHud(entry);
}

function renderPromptHud(entry: PromptHudEntry): void {
  if (!entry.theme || entry.isDisposed) {
    return;
  }

  entry.renderVersion += 1;
  entry.theme.status = entry.status;
  syncPromptHudDataset(entry);

  try {
    void Promise.resolve(entry.theme.render(entry.theme.context)).catch(
      (error) => {
        if (!(error instanceof StaleUiThemeRenderError)) {
          console.error("Failed to render command HUD", error);
        }
      },
    );
  } catch (error) {
    if (!(error instanceof StaleUiThemeRenderError)) {
      console.error("Failed to render command HUD", error);
    }
  }
}

function createThemeContext(entry: PromptHudEntry): ThemeContext {
  const guard = async <T>(promise: Promise<T>): Promise<T> => {
    const renderVersion = entry.renderVersion;
    const result = await promise;

    if (entry.isDisposed || renderVersion !== entry.renderVersion) {
      throw new StaleUiThemeRenderError();
    }

    return result;
  };

  const ensureActive = (): void => {
    if (entry.isDisposed) {
      throw new StaleUiThemeRenderError();
    }
  };

  return {
    elementContainer: entry.contentElement,
    directoryPath: entry.cwd,
    clearUi(): void {
      ensureActive();
      entry.contentElement.replaceChildren();
    },
    readFile(filePath: string): Promise<string> {
      return guard(pnex.uiThemeReadFile(filePath));
    },
    readDir(directoryPath: string): Promise<string[]> {
      return guard(pnex.uiThemeReadDir(directoryPath));
    },
    writeFile(filePath: string, content: string): Promise<void> {
      return guard(pnex.uiThemeWriteFile(filePath, content));
    },
    execCommand(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<string> {
      return guard(
        pnex.uiThemeExecCommand({
          command,
          args,
          options,
        }),
      );
    },
    isFile(filePath: string): Promise<boolean> {
      return guard(pnex.uiThemeIsFile(filePath));
    },
    resolvePath(...segments: string[]): string {
      ensureActive();
      return pnex.uiThemeResolvePath(...segments);
    },
  };
}

function clearPromptHudHistory(): void {
  for (const promptHudId of [..._promptHudOrder]) {
    disposePromptHudEntry(promptHudId, true);
  }

  _currentCwd = "";
  _activePromptHudId = null;
  _pendingExitCode = 0;
  _pendingPromptCwd = null;
}

function disposePromptHudEntry(
  promptHudId: number,
  disposeDecoration: boolean,
): void {
  const entry = _promptHudHistory.get(promptHudId);
  if (!entry || entry.isDisposed) {
    return;
  }

  entry.isDisposed = true;
  entry.hostElement = null;
  entry.contentElement.replaceChildren();
  entry.frameElement.remove();
  _promptHudHistory.delete(promptHudId);

  const orderIndex = _promptHudOrder.indexOf(promptHudId);
  if (orderIndex >= 0) {
    _promptHudOrder.splice(orderIndex, 1);
  }

  if (_activePromptHudId === promptHudId) {
    _activePromptHudId = null;
  }

  if (disposeDecoration) {
    entry.decoration.dispose();
    entry.marker.dispose();
  }
}

function createHudFrameElement(): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "pnex-command-hud-frame";
  return frame;
}

function createHudContentElement(): HTMLElement {
  const content = document.createElement("div");
  content.className = "pnex-command-hud-content pnex-hud-fade";
  return content;
}

function syncPromptHudDataset(entry: PromptHudEntry): void {
  entry.frameElement.dataset.status = entry.status;
  entry.contentElement.dataset.status = entry.status;

  if (entry.hostElement) {
    entry.hostElement.dataset.status = entry.status;
  }
}

function parseExitCode(data: string): number {
  const parsed = Number.parseInt(data, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export function extractPnexOscPayload(data: string): string {
  let sanitized = data;

  sanitized = extractPnexToken(sanitized, PNEX_STREAM_EXIT, (payload) => {
    _pendingExitCode = parseExitCode(payload);
    updateDebugOverlay(`EXIT recebido: ${payload}`);
  });

  sanitized = extractPnexToken(sanitized, PNEX_STREAM_CWD, (payload) => {
    _currentCwd = payload;
    _pendingPromptCwd = payload;
    updateDebugOverlay(`CWD recebido: ${payload}`);
    markPromptReady();
  });

  return sanitized;
}

function extractPnexToken(
  data: string,
  token: string,
  onValue: (value: string) => void,
): string {
  let sanitized = data;
  let startIndex = sanitized.indexOf(token);

  while (startIndex >= 0) {
    const valueStart = startIndex + token.length;
    const endIndex = sanitized.indexOf(token, valueStart);
    if (endIndex < 0) {
      break;
    }

    const value = sanitized.slice(valueStart, endIndex);
    onValue(value);
    sanitized =
      sanitized.slice(0, startIndex) + sanitized.slice(endIndex + token.length);
    startIndex = sanitized.indexOf(token);
  }

  return sanitized;
}

function getOrCreateDebugOverlay(container: HTMLElement): HTMLElement {
  const existing = container.querySelector<HTMLElement>(
    "#pnex-decoration-debug",
  );
  if (existing) {
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.id = "pnex-decoration-debug";
  overlay.className = "pnex-decoration-debug-overlay";
  overlay.textContent = "debug: aguardando OSC";
  container.appendChild(overlay);
  return overlay;
}

function updateDebugOverlay(message: string): void {
  if (_debugOverlay) {
    _debugOverlay.textContent = `debug: ${message}`;
  }

  console.debug("[pnex decoration debug]", message);
}
