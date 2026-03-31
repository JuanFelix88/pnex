import { Terminal } from "@xterm/xterm";

const PNEX_OSC_CWD = 9001;

let _currentCwd = "";
let _badge: HTMLElement | null = null;
let _terminal: Terminal | null = null;
let _container: HTMLElement | null = null;

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
  if (!_badge || !_terminal || !_container) return;

  const label = _badge.querySelector("span");
  if (!label) return;

  label.textContent = cwd;
  _badge.style.display = "block";

  const cursorY = _terminal.buffer.active.cursorY;
  const cellDims = getCellHeight(_terminal);
  const containerRect = _container.getBoundingClientRect();
  const termEl = _terminal.element;
  if (!termEl) return;
  const termRect = termEl.getBoundingClientRect();

  const offsetTop = termRect.top - containerRect.top;
  const top = offsetTop + cursorY * cellDims;

  _badge.style.left = "8px";
  _badge.style.top = `${top}px`;
}

function getCellHeight(terminal: Terminal): number {
  const core = (terminal as any)._core;
  if (core?._renderService?.dimensions?.css?.cell?.height) {
    return core._renderService.dimensions.css.cell.height;
  }
  return 17;
}
