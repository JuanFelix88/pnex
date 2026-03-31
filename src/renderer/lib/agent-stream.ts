import { Terminal } from "@xterm/xterm";
import { createFrameLoop, FrameLoop } from "./frame-loop";

const PNEX_OSC_CWD = 9001;

let _currentCwd = "";
let _badge: HTMLElement | null = null;
let _terminal: Terminal | null = null;
let _container: HTMLElement | null = null;
let _badgeFollowLoop: FrameLoop | null = null;

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
    _currentCwd = data;
    renderBadge(data);
    return true;
  });
}

function createBadge(container: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.id = "pnex-cwd-badge";
  el.className = "pnex-cwd-badge";
  el.innerHTML = '<span class="pnex-cwd-badge__content"></span>';
  container.appendChild(el);
  return el;
}

function renderBadge(cwd: string): void {
  if (!_badge || !_terminal || !_container || !_badgeFollowLoop) return;

  const label = _badge.querySelector("span");
  if (!label) return;

  label.textContent = cwd;
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
  const cursorElement = _terminal.element?.querySelector(".xterm-cursor");

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
