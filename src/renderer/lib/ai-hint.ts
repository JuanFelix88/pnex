import { Terminal } from "@xterm/xterm";
import { getCursorElement } from "./cursor-visibility";
import { createFrameLoop } from "./frame-loop";

const HINT_OFFSET_X = 8;
const HINT_OFFSET_Y = -1;
const EDGE_PADDING = 8;

/**
 * Show/hide the "Ctrl + I for AI" hint based on
 * whether the terminal has user-typed input on
 * the current line.
 */
export function initAiHint(terminal: Terminal): void {
  const hint = document.getElementById("ai-hint");
  if (!hint) return;

  let hasInput = false;

  const updateHint = (): void => {
    const container = hint.parentElement;
    const cursorElement = getCursorElement(terminal);

    if (!(container instanceof HTMLElement) || !cursorElement) {
      hint.style.display = "none";
      return;
    }

    if (hasInput) {
      hint.style.display = "none";
      return;
    }

    const cursorRect = cursorElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (cursorRect.width === 0 && cursorRect.height === 0) {
      hint.style.display = "none";
      return;
    }

    hint.style.display = "block";

    const hintRect = hint.getBoundingClientRect();
    const maxLeft = Math.max(
      EDGE_PADDING,
      container.clientWidth - hintRect.width - EDGE_PADDING,
    );
    const maxTop = Math.max(
      EDGE_PADDING,
      container.clientHeight - hintRect.height - EDGE_PADDING,
    );

    let left = clamp(
      cursorRect.right - containerRect.left + HINT_OFFSET_X,
      EDGE_PADDING,
      maxLeft,
    );
    let top = clamp(
      cursorRect.top - containerRect.top + HINT_OFFSET_Y,
      EDGE_PADDING,
      maxTop,
    );

    left -= 8;
    top += 1;

    hint.style.left = `${left}px`;
    hint.style.top = `${top}px`;
  };

  const followLoop = createFrameLoop(updateHint);
  followLoop.start();

  window.addEventListener("resize", updateHint);
  updateHint();

  terminal.onData((data: string) => {
    if (data === "\r" || data === "\n") {
      hasInput = false;
    } else if (data === "\x7f") {
      /* backspace - simplified heuristic */
      hasInput = false;
    } else if (data.length > 0 && !isControlChar(data)) {
      hasInput = true;
    }

    updateHint();
  });
}

function isControlChar(data: string): boolean {
  const code = data.charCodeAt(0);
  return code < 32 && code !== 13 && code !== 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
