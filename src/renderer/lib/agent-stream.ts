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
import {
  StaleOperationError,
  createStaleGuard,
  ensureActive,
} from "../../shared/utils";

declare const pnex: import("../../preload/preload").PnexApi;

const OSC_PREFIX = "\x1b]7777;";
const OSC_BEL = "\x07";
const OSC_ST = "\x1b\\";

let _oscBuffer = "";

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
  initialUiThemeName?: string,
): void {
  _terminal = terminal;
  _activeUiThemeName = initialUiThemeName || defaultUiThemeName;

  terminal.onWriteParsed(() => {
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

/**
 * Force-flush any pending prompt HUD that was detected via OSC but
 * could not be flushed through onWriteParsed (e.g. the sanitized
 * output was empty so no terminal.write occurred).
 */
export function drainPendingPromptHud(): void {
  flushPendingPromptHud();
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
  let input = _oscBuffer + data;
  _oscBuffer = "";

  let output = "";
  let cursor = 0;

  while (cursor < input.length) {
    const oscStart = input.indexOf(OSC_PREFIX, cursor);

    if (oscStart < 0) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, oscStart);

    const payloadStart = oscStart + OSC_PREFIX.length;

    const belIndex = input.indexOf(OSC_BEL, payloadStart);
    const stIndex = input.indexOf(OSC_ST, payloadStart);
    let termIndex: number;
    let termLength: number;

    if (belIndex >= 0 && (stIndex < 0 || belIndex <= stIndex)) {
      termIndex = belIndex;
      termLength = OSC_BEL.length;
    } else if (stIndex >= 0) {
      termIndex = stIndex;
      termLength = OSC_ST.length;
    } else {
      // Incomplete OSC — buffer for next chunk
      _oscBuffer = input.slice(oscStart);
      break;
    }

    const payload = input.slice(payloadStart, termIndex);
    handleOscPayload(payload);
    cursor = termIndex + termLength;
  }

  // Guard against a split OSC_PREFIX at the tail of the output.
  // If the output ends with a partial match of "\x1b]7777;" we must
  // hold it back so the next chunk can complete the sequence.
  const trailingLen = findTrailingOscPrefix(output);
  if (trailingLen > 0) {
    _oscBuffer = output.slice(output.length - trailingLen) + _oscBuffer;
    output = output.slice(0, output.length - trailingLen);
  }

  return output;
}

/**
 * Returns how many characters at the end of `data` form a partial
 * prefix of OSC_PREFIX ("\x1b]7777;"). Returns 0 when there is no
 * trailing partial match.
 */
function findTrailingOscPrefix(data: string): number {
  const maxCheck = Math.min(data.length, OSC_PREFIX.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (data.endsWith(OSC_PREFIX.slice(0, len))) {
      return len;
    }
  }
  return 0;
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
