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

declare const pnex: import("../../preload/preload").PnexApi;

const PNEX_OSC_CWD = 9001;
const PNEX_OSC_COMMAND_EXIT_CODE = 9002;

interface HudState {
  cwd: string;
  gitBranch: string;
  pendingCommits: string;
  lastExitCode: string;
  isGitBranchLoading: boolean;
  isPendingCommitsLoading: boolean;
}

let _currentCwd = "";
let _badge: HTMLElement | null = null;
let _terminal: Terminal | null = null;
let _container: HTMLElement | null = null;
let _badgeFollowLoop: FrameLoop | null = null;
let _hudState: HudState = {
  cwd: "",
  gitBranch: "",
  pendingCommits: "",
  lastExitCode: "",
  isGitBranchLoading: false,
  isPendingCommitsLoading: false,
};
let _hudRequestId = 0;

export function getCurrentCwd(): string {
  return _currentCwd;
}

export function registerAgentHandlers(
  terminal: Terminal,
  container: HTMLElement,
): void {
  _terminal = terminal;
  _container = container;
  _badge = createBadge(container);
  _badgeFollowLoop = createFrameLoop(() => {
    if (_badge?.style.display !== "block") {
      return;
    }

    positionBadgeAboveCursor();
  });

  terminal.parser.registerOscHandler(PNEX_OSC_CWD, (data) => {
    markPromptReady();
    _currentCwd = data;
    _hudState.cwd = data;
    renderHud();
    void refreshHudMetadata(data);
    return true;
  });

  terminal.parser.registerOscHandler(PNEX_OSC_COMMAND_EXIT_CODE, (data) => {
    _hudState.lastExitCode = data;
    renderHud();
    return true;
  });

  onCommandStateChange((isRunning) => {
    if (isRunning) {
      _hudState.lastExitCode = "";
    }
    renderHud();
  });
}

function createBadge(container: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.id = "pnex-cwd-badge";
  el.className = "pnex-cwd-badge";
  container.appendChild(el);
  return el;
}

function renderHud(): void {
  if (!_badge || !_terminal || !_container || !_badgeFollowLoop) return;

  const badgeElements = buildHudBadges(_hudState);
  _badge.replaceChildren(...badgeElements);
  _badge.style.display = "block";
  _badgeFollowLoop.start();

  requestAnimationFrame(() => {
    positionBadgeAboveCursor();
  });
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

function buildHudBadges(state: HudState): HTMLElement[] {
  const badges: HTMLElement[] = [createStatusDot(state.lastExitCode)];

  if (state.cwd) {
    badges.push(createBadgeItem(state.cwd, "cwd"));
  }

  if (state.isGitBranchLoading) {
    badges.push(createBadgeItem("", "skeleton"));
  } else if (state.gitBranch) {
    badges.push(createBadgeItem(`branch: ${state.gitBranch}`, "git"));
  }

  if (state.isPendingCommitsLoading) {
    badges.push(createBadgeItem("", "skeleton skeleton--short"));
  } else if (state.pendingCommits) {
    badges.push(createBadgeItem(`pending: ${state.pendingCommits}`, "pending"));
  }

  return badges;
}

function getStatusDotModifier(lastExitCode: string): string {
  if (lastExitCode === "") return "pnex-status-dot--running";
  return lastExitCode === "0"
    ? "pnex-status-dot--success"
    : "pnex-status-dot--error";
}

function createStatusDot(lastExitCode: string): HTMLElement {
  const dot = document.createElement("span");
  dot.className = `pnex-status-dot ${getStatusDotModifier(lastExitCode)}`;
  return dot;
}

function createBadgeItem(label: string, variant?: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "pnex-cwd-badge__content";

  if (variant) {
    const tokens = variant.split(" ");
    const [dataVariant] = tokens;
    badge.dataset.variant = dataVariant;

    tokens.slice(1).forEach((token) => {
      badge.classList.add(token);
    });
  }

  badge.textContent = label;
  return badge;
}

async function refreshHudMetadata(cwd: string): Promise<void> {
  const requestId = ++_hudRequestId;

  _hudState.isGitBranchLoading = true;
  _hudState.isPendingCommitsLoading = true;
  _hudState.gitBranch = "";
  _hudState.pendingCommits = "";
  renderHud();

  try {
    const hud = await pnex.getTerminalHud(cwd);
    if (requestId !== _hudRequestId) {
      return;
    }

    _hudState.gitBranch = hud.gitBranch;
    _hudState.pendingCommits =
      hud.pendingCommits && hud.pendingCommits !== "0"
        ? hud.pendingCommits
        : "";
  } catch {
    if (requestId !== _hudRequestId) {
      return;
    }

    _hudState.gitBranch = "";
    _hudState.pendingCommits = "";
  } finally {
    if (requestId !== _hudRequestId) {
      return;
    }

    _hudState.isGitBranchLoading = false;
    _hudState.isPendingCommitsLoading = false;
    renderHud();
  }
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
