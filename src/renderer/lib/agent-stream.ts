import { Terminal } from "@xterm/xterm";
import { createFrameLoop, FrameLoop } from "./frame-loop";
import {
  getCursorElement,
  isCursorVisibleInContainer,
} from "./cursor-visibility";
import {
  isCommandRunning,
  markPromptReady,
  onCommandStateChange,
} from "./terminal-command-state";
import { findUiThemeByName, defaultUiThemeName } from "../ui-themes";
import { ThemeContext } from "../ui-themes/theme-base";

declare const pnex: import("../../preload/preload").PnexApi;

const PNEX_OSC_CWD = 9001;
const PNEX_OSC_COMMAND_EXIT_CODE = 9002;

class StaleUiThemeRenderError extends Error {
  public constructor() {
    super("Stale UI theme render");
  }
}

let _currentCwd = "";
let _badge: HTMLElement | null = null;
let _terminal: Terminal | null = null;
let _container: HTMLElement | null = null;
let _badgeFollowLoop: FrameLoop | null = null;
let _activeUiThemeName = defaultUiThemeName;
let _uiThemeRenderId = 0;

export function getCurrentCwd(): string {
  return _currentCwd;
}

export function registerAgentHandlers(
  terminal: Terminal,
  container: HTMLElement,
  initialUiThemeName?: string,
): void {
  _terminal = terminal;
  _container = container;
  _activeUiThemeName = initialUiThemeName || defaultUiThemeName;
  _badge = createBadge(container);
  _badgeFollowLoop = createFrameLoop(() => {
    if (_badge?.style.display === "none") {
      return;
    }

    positionBadgeAboveCursor();
  });

  terminal.parser.registerOscHandler(PNEX_OSC_CWD, (data) => {
    markPromptReady();
    _currentCwd = data;
    void renderHud();
    return true;
  });

  terminal.parser.registerOscHandler(PNEX_OSC_COMMAND_EXIT_CODE, (data) => {
    void data;
    requestAnimationFrame(() => {
      positionBadgeAboveCursor();
    });
    return true;
  });

  pnex.onUiThemeChanged((themeName) => {
    _activeUiThemeName = themeName || defaultUiThemeName;
    void renderHud();
  });

  onCommandStateChange(() => {
    requestAnimationFrame(() => {
      positionBadgeAboveCursor();
    });
  });
}

function createBadge(container: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.id = "pnex-ui-theme-hud";
  el.className = "pnex-ui-theme-hud pnex-hud-fade";
  el.style.display = "none";
  container.appendChild(el);
  return el;
}

async function renderHud(): Promise<void> {
  if (!_badge || !_terminal || !_container || !_badgeFollowLoop) return;
  if (!_currentCwd) {
    _badge.replaceChildren();
    _badge.style.display = "none";
    return;
  }

  const renderId = ++_uiThemeRenderId;
  const themeCtor = findUiThemeByName(_activeUiThemeName);
  const context = createThemeContext(_badge, _currentCwd, renderId);
  const theme = new themeCtor(context);

  _badge.dataset.uiTheme = theme.name;
  _badge.style.display = "flex";
  _badgeFollowLoop.start();

  try {
    context.clearUi();
    await Promise.resolve(theme.render(context));
  } catch (error) {
    if (!(error instanceof StaleUiThemeRenderError)) {
      console.error("Failed to render UI theme", error);
    }
    return;
  }

  if (renderId !== _uiThemeRenderId) {
    return;
  }

  requestAnimationFrame(() => {
    positionBadgeAboveCursor();
  });
}

function createThemeContext(
  elementContainer: HTMLElement,
  directoryPath: string,
  renderId: number,
): ThemeContext {
  const ensureActiveRender = (): void => {
    if (renderId !== _uiThemeRenderId) {
      throw new StaleUiThemeRenderError();
    }
  };

  const guard = async <T>(promise: Promise<T>): Promise<T> => {
    const result = await promise;
    ensureActiveRender();
    return result;
  };

  return {
    elementContainer,
    directoryPath,
    clearUi(): void {
      ensureActiveRender();
      elementContainer.replaceChildren();
    },
    readFile(filePath: string): Promise<string> {
      return guard(pnex.uiThemeReadFile(filePath));
    },
    readDir(dirPath: string): Promise<string[]> {
      return guard(pnex.uiThemeReadDir(dirPath));
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
      ensureActiveRender();
      return pnex.uiThemeResolvePath(...segments);
    },
  };
}

function positionBadgeAboveCursor(): void {
  if (!_badge || !_terminal || !_container) return;

  const cellHeight = getCellHeight(_terminal);
  const containerRect = _container.getBoundingClientRect();
  const cursorElement = getCursorElement(_terminal);
  const isCursorVisible =
    !isCommandRunning() && isCursorVisibleInContainer(_terminal, _container);

  _badge.classList.toggle("pnex-hud-hidden", !isCursorVisible);

  if (!(cursorElement instanceof HTMLElement)) {
    positionBadgeUsingBuffer(cellHeight, containerRect);
    return;
  }

  const cursorRect = cursorElement.getBoundingClientRect();
  const badgeRect = _badge.getBoundingClientRect();
  const left = 8;
  const top = cursorRect.top - containerRect.top - badgeRect.height;

  _badge.style.left = `${left}px`;
  _badge.style.top = `${Math.max(0, top)}px`;
}

function positionBadgeUsingBuffer(
  cellHeight: number,
  containerRect: DOMRect,
): void {
  if (!_badge || !_terminal) return;

  const cursorY = _terminal.buffer.active.cursorY;
  const termRect = _terminal.element?.getBoundingClientRect();
  if (!termRect) return;

  const badgeRect = _badge.getBoundingClientRect();
  const offsetTop = termRect.top - containerRect.top;
  const top = offsetTop + Math.max(cursorY - 1, 0) * cellHeight;
  const centeredTop = top + Math.max((cellHeight - badgeRect.height) / 2, 0);

  _badge.style.left = "8px";
  _badge.style.top = `${centeredTop}px`;
}

function getCellHeight(terminal: Terminal): number {
  const core = (terminal as any)._core;
  if (core?._renderService?.dimensions?.css?.cell?.height) {
    return core._renderService.dimensions.css.cell.height;
  }
  return 17;
}
