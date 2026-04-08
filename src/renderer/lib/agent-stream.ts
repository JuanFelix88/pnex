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
import { isChatMode, onChatModeChange } from "./chat-mode-state";
import {
  StaleOperationError,
  createStaleGuard,
  ensureActive,
} from "../../shared/utils";
import { PNEX_OSC_ID } from "../../lib/terminal/osc";

declare const pnex: import("../../preload/preload").PnexApi;

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
let _focusedPromptHudId: number | null = null;
let _firstHudHasRendered = false;
const _onFirstHudRenderCallbacks: Array<() => void> = [];

const _promptHudHistory = new Map<number, PromptHudEntry>();
const _promptHudOrder: number[] = [];
export function getCurrentCwd(): string {
  return _currentCwd;
}

export function onFirstHudRender(callback: () => void): void {
  if (_firstHudHasRendered) {
    callback();
    return;
  }
  _onFirstHudRenderCallbacks.push(callback);
}

export function resetCommandHudHistory(): void {
  clearPromptHudHistory();
}

export function focusPreviousPromptHud(): boolean {
  if (!_terminal) {
    return false;
  }

  const viewportLine = _terminal.buffer.active.viewportY;
  const targetEntry = findPreviousPromptHud(viewportLine);
  if (!targetEntry) {
    return false;
  }

  focusPromptHud(targetEntry);
  return true;
}

export function registerAgentHandlers(
  terminal: Terminal,
  initialUiThemeName?: string,
): void {
  _terminal = terminal;
  _activeUiThemeName = initialUiThemeName || defaultUiThemeName;

  terminal.parser.registerOscHandler(PNEX_OSC_ID, (data) => {
    handleOscPayload(data);
    // Flush immediately during parsing — the cursor is at the exact
    // position where the OSC was emitted.  Deferring to onWriteParsed
    // is unreliable because xterm may batch writes or the cursor may
    // have moved by the time onWriteParsed fires.
    flushPendingPromptHud();
    return true;
  });

  terminal.onWriteParsed(() => {
    // Safety-net: catches any pending HUD that was not flushed inside
    // the OSC handler (e.g. exit and cwd arriving in separate writes).
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

  onChatModeChange(() => {
    syncChatModeToActiveTheme();
  });
}

function createPromptHud(cwd: string): void {
  if (!_terminal) {
    return;
  }

  const ThemeCtor = findUiThemeByName(_activeUiThemeName);
  const markerOffset = new ThemeCtor({} as ThemeContext).markerOffset;

  const marker = _terminal.registerMarker(markerOffset);
  const decoration = _terminal.registerDecoration({
    marker,
    x: 0,
    width: 1,
    height: 1,
  });

  if (!decoration) {
    return;
  }

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

    if (!_firstHudHasRendered) {
      _firstHudHasRendered = true;
      for (const cb of _onFirstHudRenderCallbacks) cb();
      _onFirstHudRenderCallbacks.length = 0;
    }

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
  theme.isChatMode = isChatMode();
  theme.doRender = () => {
    renderPromptHudById(entry.id);
  };

  entry.theme = theme;
  renderPromptHud(entry);

  if (!runInitialLoad) {
    return;
  }

  void Promise.resolve(theme.onInitialLoad()).catch((error) => {
    if (!(error instanceof StaleOperationError)) {
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
        if (!(error instanceof StaleOperationError)) {
          console.error("Failed to render command HUD", error);
        }
      },
    );
  } catch (error) {
    if (!(error instanceof StaleOperationError)) {
      console.error("Failed to render command HUD", error);
    }
  }
}

function createThemeContext(entry: PromptHudEntry): ThemeContext {
  const guard = createStaleGuard(entry);

  return {
    elementContainer: entry.contentElement,
    directoryPath: entry.cwd,
    clearUi(): void {
      ensureActive(entry);
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
      ensureActive(entry);
      return pnex.uiThemeResolvePath(...segments);
    },
    username: pnex.getUsername(),
  };
}

function clearPromptHudHistory(): void {
  for (const promptHudId of [..._promptHudOrder]) {
    disposePromptHudEntry(promptHudId, true);
  }

  _currentCwd = "";
  _activePromptHudId = null;
  _focusedPromptHudId = null;
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

  if (_focusedPromptHudId === promptHudId) {
    _focusedPromptHudId = null;
  }

  if (disposeDecoration) {
    entry.decoration.dispose();
    entry.marker.dispose();
  }
}

function findPreviousPromptHud(referenceLine: number): PromptHudEntry | null {
  let targetEntry: PromptHudEntry | null = null;

  for (const promptHudId of _promptHudOrder) {
    const entry = _promptHudHistory.get(promptHudId);
    if (!entry || entry.isDisposed) {
      continue;
    }

    const markerLine = entry.marker.line;
    if (markerLine < 0 || markerLine >= referenceLine) {
      continue;
    }

    if (!targetEntry || markerLine > targetEntry.marker.line) {
      targetEntry = entry;
    }
  }

  return targetEntry;
}

function focusPromptHud(entry: PromptHudEntry): void {
  if (!_terminal || entry.isDisposed) {
    return;
  }

  const markerLine = entry.marker.line;
  if (markerLine < 0) {
    return;
  }

  setFocusedPromptHud(entry.id);
  _terminal.scrollToLine(markerLine - 2);
  _terminal.focus();
}

function setFocusedPromptHud(promptHudId: number | null): void {
  if (_focusedPromptHudId === promptHudId) {
    return;
  }

  const previousId = _focusedPromptHudId;
  _focusedPromptHudId = promptHudId;

  if (previousId !== null) {
    const previousEntry = _promptHudHistory.get(previousId);
    if (previousEntry && !previousEntry.isDisposed) {
      syncPromptHudDataset(previousEntry);
    }
  }

  if (promptHudId !== null) {
    const nextEntry = _promptHudHistory.get(promptHudId);
    if (nextEntry && !nextEntry.isDisposed) {
      syncPromptHudDataset(nextEntry);
    }
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

function syncChatModeToActiveTheme(): void {
  if (_activePromptHudId === null) {
    return;
  }

  const entry = _promptHudHistory.get(_activePromptHudId);
  if (!entry || entry.isDisposed || !entry.theme) {
    return;
  }

  const active = isChatMode();
  if (entry.theme.isChatMode !== active) {
    entry.theme.isChatMode = active;
    renderPromptHud(entry);
  }
}

function syncPromptHudDataset(entry: PromptHudEntry): void {
  entry.frameElement.dataset.status = entry.status;
  entry.contentElement.dataset.status = entry.status;
  const isFocused = entry.id === _focusedPromptHudId;

  entry.frameElement.dataset.focused = isFocused ? "true" : "false";
  entry.contentElement.dataset.focused = isFocused ? "true" : "false";

  if (entry.hostElement) {
    entry.hostElement.dataset.status = entry.status;
    entry.hostElement.dataset.focused = isFocused ? "true" : "false";
  }
}

function parseExitCode(data: string): number {
  const parsed = Number.parseInt(data, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function handleOscPayload(payload: string): void {
  const eqIndex = payload.indexOf("=");
  if (eqIndex < 0) return;

  const key = payload.slice(0, eqIndex);
  const value = payload.slice(eqIndex + 1);

  if (key === "exit") {
    _pendingExitCode = parseExitCode(value);
  } else if (key === "cwd") {
    _currentCwd = value;
    _pendingPromptCwd = value;
    markPromptReady();
  }
}
